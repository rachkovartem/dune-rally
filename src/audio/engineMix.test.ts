// src/audio/engineMix.test.ts
import { describe, it, expect } from 'vitest';
import {
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  bodyScrapeSpeed,
  boostTarget,
  engineLoadTarget,
  layerWeights,
  playbackRateFor,
  scrapeGain,
  smoothToward,
  stepBoost,
  tyreSound,
  windSound,
  type LayerWeights,
} from './engineMix';
import type { DrivetrainSpec } from '../../shared/drivetrain';
import { vehicleConfigFor } from '../vehicle/vehicleConfig';
import type { LayerName } from './soundManifest';

const RECORDED: Record<LayerName, number> = { idle: 800, low: 1600, mid: 3200, high: 6400 };
const sumOfSquares = (weights: LayerWeights): number => Object.values(weights).reduce((sum, weight) => sum + weight * weight, 0);

describe('layerWeights — which engine loop is heard at an rpm', () => {
  it('plays only the lowest loop at or below its recorded rpm', () => {
    expect(layerWeights(800, RECORDED)).toEqual({ idle: 1, low: 0, mid: 0, high: 0 });
    expect(layerWeights(300, RECORDED)).toEqual({ idle: 1, low: 0, mid: 0, high: 0 });
  });

  it('plays only the highest loop at or above its recorded rpm', () => {
    expect(layerWeights(6400, RECORDED)).toEqual({ idle: 0, low: 0, mid: 0, high: 1 });
    expect(layerWeights(9000, RECORDED)).toEqual({ idle: 0, low: 0, mid: 0, high: 1 });
  });

  it('plays a middle loop alone exactly at its recorded rpm', () => {
    const weights = layerWeights(1600, RECORDED);
    expect(weights.low).toBeCloseTo(1, 12);
    expect(weights.idle + weights.mid + weights.high).toBeCloseTo(0, 12);
  });

  it('keeps the loudness steady through a crossfade (equal power) at every rpm', () => {
    for (let rpm = 500; rpm <= 7000; rpm += 37) expect(sumOfSquares(layerWeights(rpm, RECORDED))).toBeCloseTo(1, 9);
  });

  it('blends two neighbours evenly halfway between them on a log-rpm scale', () => {
    const weights = layerWeights(Math.sqrt(1600 * 3200), RECORDED);
    expect(weights.low).toBeCloseTo(Math.SQRT1_2, 9);
    expect(weights.mid).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('never plays more than two loops at once', () => {
    for (let rpm = 500; rpm <= 7000; rpm += 53) {
      expect(Object.values(layerWeights(rpm, RECORDED)).filter((weight) => weight > 1e-12).length).toBeLessThanOrEqual(2);
    }
  });

  it('orders the loops by their recorded rpm, not by their layer names', () => {
    // The player can pick any loop for any layer, so a "low" loop may be recorded above the "mid" one.
    const swapped = { idle: 800, low: 3200, mid: 1600, high: 6400 };
    const weights = layerWeights(1700, swapped);
    expect(weights.mid).toBeGreaterThan(0.9);
    expect(weights.low).toBeGreaterThan(0);
  });

  it('throws for a NaN rpm instead of going silent', () => {
    expect(() => layerWeights(Number.NaN, RECORDED)).toThrow('no loop pair holds rpm NaN');
  });
});

describe('playbackRateFor', () => {
  it('plays at the recorded speed when the engine turns at the recorded rpm', () => {
    expect(playbackRateFor(2000, 2000)).toBe(1);
  });

  it('follows the rpm ratio inside the natural-sounding range', () => {
    expect(playbackRateFor(2200, 2000)).toBeCloseTo(1.1, 12);
  });

  it('stays inside the range far from the recorded rpm', () => {
    expect(playbackRateFor(100, 2000)).toBe(PLAYBACK_RATE_MIN);
    expect(playbackRateFor(9000, 2000)).toBe(PLAYBACK_RATE_MAX);
  });
});

describe('engineLoadTarget', () => {
  const pajero: DrivetrainSpec = vehicleConfigFor('pajero').drivetrain;
  const forester: DrivetrainSpec = vehicleConfigFor('forester').drivetrain;
  const idleState = { rpm: 2000, gear: 2, ratio: 2, shiftTimer: 0 };

  it('follows the pedal share', () => {
    expect(engineLoadTarget(forester, idleState, { drive: 0.6, brake: 0, direction: 1 })).toBeCloseTo(0.6, 12);
    expect(engineLoadTarget(forester, idleState, { drive: 0, brake: 1, direction: 1 })).toBe(0);
  });

  it('dips during an automatic\'s shift, so each upshift is heard', () => {
    const shifting = { ...idleState, shiftTimer: 0.1 };
    const full = { drive: 1, brake: 0, direction: 1 } as const;
    expect(engineLoadTarget(pajero, shifting, full)).toBeLessThan(engineLoadTarget(pajero, idleState, full));
  });

  it('never dips for a CVT, which has no shifts', () => {
    const withTimer = { ...idleState, shiftTimer: 0.1 };
    expect(engineLoadTarget(forester, withTimer, { drive: 1, brake: 0, direction: 1 })).toBe(1);
  });
});

describe('smoothToward', () => {
  it('moves part of the way in a short step', () => {
    expect(smoothToward(0, 10, 2, 0.1)).toBeCloseTo(2, 12);
  });

  it('lands exactly on the target and never past it in a long step', () => {
    expect(smoothToward(0, 10, 2, 5)).toBe(10);
    expect(smoothToward(10, 0, 50, 1)).toBe(0);
  });
});

describe('turbo boost (the Pajero whistle)', () => {
  it('is 0 without a turbo', () => {
    expect(boostTarget(false, 4000, 1)).toBe(0);
  });

  it('is 0 at idle load, whatever the rpm', () => {
    expect(boostTarget(true, 3500, 0)).toBe(0);
  });

  it('is 0 below the spool rpm and full at the top of the spool band', () => {
    expect(boostTarget(true, 1400, 1)).toBe(0);
    expect(boostTarget(true, 3000, 1)).toBe(1);
    expect(boostTarget(true, 4500, 1)).toBe(1);
  });

  it('rises with load', () => {
    expect(boostTarget(true, 3000, 0.8)).toBeGreaterThan(boostTarget(true, 3000, 0.3));
  });

  it('builds slower than it falls (lag up, blow-off down)', () => {
    const rise = stepBoost(0, 1, 0.1) - 0;
    const fall = 1 - stepBoost(1, 0, 0.1);
    expect(rise).toBeGreaterThan(0);
    expect(fall).toBeGreaterThan(rise);
  });
});

describe('tyreSound and windSound', () => {
  it('makes no tyre noise with every wheel in the air, or with no wheels at all', () => {
    expect(tyreSound('sand', 20, 0, 4).gain).toBe(0);
    expect(tyreSound('sand', 20, 0, 0).gain).toBe(0);
  });

  it('makes tyre noise grow with speed and the number of wheels on the ground', () => {
    expect(tyreSound('road', 0, 4, 4).gain).toBe(0);
    expect(tyreSound('road', 10, 4, 4).gain).toBeGreaterThan(tyreSound('road', 5, 4, 4).gain);
    expect(tyreSound('road', 10, 4, 4).gain).toBeGreaterThan(tyreSound('road', 10, 2, 4).gain);
    expect(tyreSound('road', 20, 4, 4).frequency).toBeGreaterThan(tyreSound('road', 5, 4, 4).frequency);
  });

  it('stops the tyre noise growing above 25 m/s', () => {
    expect(tyreSound('gravel', 40, 4, 4).gain).toBe(tyreSound('gravel', 25, 4, 4).gain);
  });

  it('is silent at a standstill and stops growing above 50 m/s', () => {
    expect(windSound(0).gain).toBe(0);
    expect(windSound(30).gain).toBeGreaterThan(windSound(10).gain);
    expect(windSound(70).gain).toBe(windSound(50).gain);
  });
});

describe('bodyScrapeSpeed — the car sliding on its roof or side', () => {
  const onTheRoof = { upY: -1, wheelsInContact: 0, groundClearance: 0.3, speed: 6 };

  it('scrapes at the sliding speed when the body lies on the ground with no wheel down', () => {
    expect(bodyScrapeSpeed(onTheRoof)).toBe(6);
  });

  it('is silent while any wheel touches the ground', () => {
    expect(bodyScrapeSpeed({ ...onTheRoof, wheelsInContact: 1 })).toBe(0);
  });

  it('is silent for an upright car in the air, and scrapes on its side exactly at the tilt limit', () => {
    expect(bodyScrapeSpeed({ ...onTheRoof, upY: 0.51 })).toBe(0);
    expect(bodyScrapeSpeed({ ...onTheRoof, upY: 0.5 })).toBe(6);
  });

  it('is silent for a body too high above the ground to touch it', () => {
    expect(bodyScrapeSpeed({ ...onTheRoof, groundClearance: 1.21 })).toBe(0);
    expect(bodyScrapeSpeed({ ...onTheRoof, groundClearance: 1.2 })).toBe(6);
  });

  it('gets louder with the sliding speed up to a cap', () => {
    expect(scrapeGain(0)).toBe(0);
    expect(scrapeGain(4)).toBeGreaterThan(scrapeGain(2));
    expect(scrapeGain(20)).toBe(scrapeGain(8));
  });
});
