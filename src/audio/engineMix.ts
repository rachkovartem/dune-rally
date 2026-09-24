// src/audio/engineMix.ts
// Pure numbers behind the engine sound: which loop is heard at an rpm, how fast it plays, how
// loaded the engine sounds. No Web Audio here, so every rule can be checked without a browser.
import type { Cover } from '../world/biome';
import type { DrivetrainSpec, DrivetrainState, PedalIntent } from '../../shared/drivetrain';
import { LAYER_NAMES, type LayerName } from './soundManifest';

export const PLAYBACK_RATE_MIN = 0.7;
export const PLAYBACK_RATE_MAX = 1.35;

export type LayerWeights = Record<LayerName, number>;

/**
 * Crossfade weights of the four loops for an engine rpm. Below the lowest recorded rpm only the
 * lowest loop plays, above the highest only the highest; between two neighbours the blend is
 * equal-power on a log-rpm scale, so every octave of rpm gets the same blend length.
 */
export function layerWeights(rpm: number, recordedRpm: Readonly<Record<LayerName, number>>): LayerWeights {
  const weights: LayerWeights = { idle: 0, low: 0, mid: 0, high: 0 };
  const ordered = LAYER_NAMES.map((name) => ({ name, rpm: recordedRpm[name] })).sort((first, second) => first.rpm - second.rpm);
  const lowest = ordered[0];
  const highest = ordered[ordered.length - 1];
  if (rpm <= lowest.rpm) {
    weights[lowest.name] = 1;
    return weights;
  }
  if (rpm >= highest.rpm) {
    weights[highest.name] = 1;
    return weights;
  }
  for (let index = 0; index < ordered.length - 1; index++) {
    const lower = ordered[index];
    const upper = ordered[index + 1];
    if (rpm >= lower.rpm && rpm < upper.rpm) {
      const blend = Math.log(rpm / lower.rpm) / Math.log(upper.rpm / lower.rpm);
      weights[lower.name] = Math.cos((blend * Math.PI) / 2);
      weights[upper.name] = Math.sin((blend * Math.PI) / 2);
      return weights;
    }
  }
  // Only a NaN rpm or recorded rpm gets here: every finite rpm between the ends falls into a pair.
  throw new Error(`layerWeights: no loop pair holds rpm ${rpm}`);
}

/** A loop recorded at `recordedRpm` plays faster or slower to match the engine, within a range that still sounds natural. */
export function playbackRateFor(rpm: number, recordedRpm: number): number {
  return Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, rpm / recordedRpm));
}

/**
 * How hard the engine works, 0..1: the pedal share the drivetrain gets, cut to the gearbox's
 * torque share while an automatic shifts, so each upshift is heard as a short dip.
 */
export function engineLoadTarget(spec: DrivetrainSpec, state: Readonly<DrivetrainState>, intent: PedalIntent): number {
  const shifting = spec.gearbox.kind === 'automatic' && state.shiftTimer > 0 ? spec.gearbox.shiftTorqueFactor : 1;
  return Math.min(1, Math.max(0, intent.drive * shifting));
}

/** Moves `value` toward `target` at `rate` per second, never past it. */
export function smoothToward(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * Math.min(1, dt * rate);
}

// The turbo starts to build boost above this rpm and is fully spooled this many rpm later.
const BOOST_START_RPM = 1400;
const BOOST_SPOOL_RPM = 1600;

/** Boost the turbo would reach at this rpm and load; 0 for an engine without a turbo. */
export function boostTarget(hasTurbo: boolean, rpm: number, load: number): number {
  if (!hasTurbo) return 0;
  return load * Math.min(1, Math.max(0, (rpm - BOOST_START_RPM) / BOOST_SPOOL_RPM));
}

/** Boost builds slowly (turbo lag) and falls faster (the blow-off when the pedal is released). */
export function stepBoost(boost: number, target: number, dt: number): number {
  return smoothToward(boost, target, target > boost ? 1.5 : 4, dt);
}

/** Pitch of the turbo whistle, Hz; it rises with boost. */
export const whistleFrequency = (boost: number): number => 3000 + 3000 * boost;

export interface TyreVoice {
  /** Low-pass cut-off at a standstill, Hz. */
  baseHz: number;
  /** Cut-off rise per m/s of speed. */
  hzPerSpeed: number;
  gain: number;
}

// Sand and road are the prototype's values, tuned by ear; the other covers sit between the two by
// how soft and loose they are.
export const TYRE_VOICE_BY_COVER: Readonly<Record<Cover, TyreVoice>> = {
  sand: { baseHz: 180, hzPerSpeed: 12, gain: 0.5 },
  beach: { baseHz: 180, hzPerSpeed: 12, gain: 0.45 },
  mud: { baseHz: 150, hzPerSpeed: 8, gain: 0.45 },
  snow: { baseHz: 200, hzPerSpeed: 10, gain: 0.35 },
  water: { baseHz: 500, hzPerSpeed: 20, gain: 0.5 },
  dryGrass: { baseHz: 260, hzPerSpeed: 20, gain: 0.35 },
  grass: { baseHz: 240, hzPerSpeed: 18, gain: 0.3 },
  forest: { baseHz: 240, hzPerSpeed: 18, gain: 0.3 },
  dirt: { baseHz: 300, hzPerSpeed: 24, gain: 0.35 },
  gravel: { baseHz: 420, hzPerSpeed: 32, gain: 0.4 },
  rock: { baseHz: 380, hzPerSpeed: 30, gain: 0.35 },
  road: { baseHz: 350, hzPerSpeed: 30, gain: 0.3 },
};

/** Tyre noise cut-off and level: only the wheels on the ground make it, and it grows with speed. */
export function tyreSound(cover: Cover, speed: number, wheelsInContact: number, wheelCount: number): { frequency: number; gain: number } {
  const voice = TYRE_VOICE_BY_COVER[cover];
  const traction = wheelCount > 0 ? wheelsInContact / wheelCount : 0;
  return {
    frequency: voice.baseHz + speed * voice.hzPerSpeed,
    gain: traction * Math.min(1, speed / 25) * voice.gain,
  };
}

export function windSound(speed: number): { frequency: number; gain: number } {
  return { frequency: 400 + speed * 18, gain: 0.35 * Math.min(1, (speed / 50) ** 2) };
}

// A body closer to the ground than this, with no wheel on it, is lying on its roof or side.
const SCRAPE_CLEARANCE = 1.2;
// Up axis pointing higher than this is a car in the air on its wheels, not one sliding on its body.
const SCRAPE_MAX_UP = 0.5;

/** Speed of the body sliding on the ground (car on its roof or side), 0 while any wheel touches. */
export function bodyScrapeSpeed(input: { upY: number; wheelsInContact: number; groundClearance: number; speed: number }): number {
  if (input.wheelsInContact > 0 || input.upY > SCRAPE_MAX_UP || input.groundClearance > SCRAPE_CLEARANCE) return 0;
  return input.speed;
}

export const scrapeGain = (scrapeSpeed: number): number => 0.6 * Math.min(1, scrapeSpeed / 8);
