// shared/carBench.test.ts
// The car comparison promises of spec v4 (C2.6–C2.12) and the user's real-car targets, measured
// on the same driving model the game runs. Bands are relations or "≈" ranges, not tuned numbers.
import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  runBraking, runRollover, runStraightLine, runTurn, speedAt, type StraightLineResult,
} from './carBench';
import { terrainGripFor } from './terrainGrip';
import { CAR_IDS, type CarId } from '../src/vehicle/cars';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';

const KMH = 1 / 3.6;
const DEGREE = Math.PI / 180;

type Surface = 'road' | 'sand';
const gripOf = (carId: CarId, surface: Surface): number => terrainGripFor(surface, vehicleConfigFor(carId));

const straightRuns = new Map<string, StraightLineResult>();
/** Full throttle for 70 s, once per car and surface: long enough for 0–100 and the top speed. */
function straightRun(carId: CarId, surface: Surface): StraightLineResult {
  const key = `${carId}:${surface}`;
  let result = straightRuns.get(key);
  if (!result) {
    result = runStraightLine(vehicleConfigFor(carId), gripOf(carId, surface), 70);
    straightRuns.set(key, result);
  }
  return result;
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('runStraightLine — acceleration and top speed (R120, R121, R123, R124)', () => {
  it('the Forester is faster than the Pajero 5 s after a standing start on the road (C2.6)', () => {
    expect(speedAt(straightRun('forester', 'road'), 5)).toBeGreaterThan(speedAt(straightRun('pajero', 'road'), 5));
  });

  it('the Forester reaches a higher top speed than the Pajero (C2.7)', () => {
    expect(runStraightLine(vehicleConfigFor('forester'), 1, 20).topSpeed)
      .toBeGreaterThan(runStraightLine(vehicleConfigFor('pajero'), 1, 20).topSpeed);
    expect(straightRun('forester', 'road').topSpeed).toBeGreaterThan(straightRun('pajero', 'road').topSpeed);
  });

  it.each(CAR_IDS)('the %s is slower on sand than on the road after 5 s (C2.11)', (carId) => {
    expect(speedAt(straightRun(carId, 'sand'), 5)).toBeLessThan(speedAt(straightRun(carId, 'road'), 5));
  });

  it('the Pajero loses less of its speed on sand than the Forester does (C2.12)', () => {
    const sandLoss = (carId: CarId): number => 1 - speedAt(straightRun(carId, 'sand'), 5) / speedAt(straightRun(carId, 'road'), 5);
    expect(sandLoss('pajero')).toBeLessThan(sandLoss('forester'));
  });

  // The user's targets for the real cars (journal, "user feedback on the drivable prototype"):
  // Forester 0–100 ≈ 9 s, top ≈ 190–200 km/h; Pajero 0–100 ≈ 11.5 s, top ≈ 175–180 km/h.
  // "≈" is read as ±10 % on the time and ±5 % on the ends of the speed range.
  it.each<[CarId, number, number, number]>([
    ['forester', 9, 190, 200],
    ['pajero', 11.5, 175, 180],
  ])('the %s runs 0–100 km/h in about %s s and tops out at about %s–%s km/h on the road', (carId, zeroToHundred, topLow, topHigh) => {
    const run = straightRun(carId, 'road');
    expect(run.timeTo100).not.toBeNull();
    expect(run.timeTo100 ?? Infinity).toBeGreaterThanOrEqual(zeroToHundred * 0.9);
    expect(run.timeTo100 ?? Infinity).toBeLessThanOrEqual(zeroToHundred * 1.1);
    expect(run.topSpeed).toBeGreaterThanOrEqual(topLow * 0.95 * KMH);
    expect(run.topSpeed).toBeLessThanOrEqual(topHigh * 1.05 * KMH);
  });

  it('reaches 60 km/h before 100 km/h and never reports a time for a speed it did not reach', () => {
    const run = straightRun('forester', 'road');
    expect(run.timeTo60 ?? Infinity).toBeLessThan(run.timeTo100 ?? -Infinity);
    const short = runStraightLine(vehicleConfigFor('pajero'), 1, 2);
    expect(short.timeTo100).toBeNull();
    expect(short.topSpeed).toBeLessThan(100 * KMH);
  });
});

describe('speedAt', () => {
  it('reads the speed at the end of the run', () => {
    const run = runStraightLine(vehicleConfigFor('forester'), 1, 2);
    expect(speedAt(run, 2)).toBe(run.samples[run.samples.length - 1].speed);
  });

  it('throws when the run did not last that long, instead of reading the last sample', () => {
    const run = runStraightLine(vehicleConfigFor('forester'), 1, 2);
    expect(() => speedAt(run, 5)).toThrow('speedAt: the run ended at');
    expect(() => speedAt({ samples: [], timeTo60: null, timeTo100: null, topSpeed: 0 }, 1)).toThrow('speedAt');
  });
});

describe('runBraking', () => {
  it.each(CAR_IDS)('stops the %s from 100 km/h on the road in a real-car distance', (carId) => {
    // A road car on tarmac stops from 100 km/h in roughly 35–50 m.
    const braking = runBraking(vehicleConfigFor(carId), gripOf(carId, 'road'), 100 * KMH);
    expect(braking.distance).toBeGreaterThanOrEqual(35);
    expect(braking.distance).toBeLessThanOrEqual(50);
  });

  it.each(CAR_IDS)('needs a longer distance to stop the %s on sand than on the road', (carId) => {
    const road = runBraking(vehicleConfigFor(carId), gripOf(carId, 'road'), 100 * KMH);
    const sand = runBraking(vehicleConfigFor(carId), gripOf(carId, 'sand'), 100 * KMH);
    expect(sand.distance).toBeGreaterThan(road.distance);
  });
});

describe('runTurn — steering (R122)', () => {
  it('the Forester turns further than the Pajero with the same input in 5 s (C2.8)', () => {
    const turn = (carId: CarId): number =>
      runTurn(vehicleConfigFor(carId), { entrySpeed: 0, seconds: 5, steer: -1, grip: gripOf(carId, 'road') }).headingChange;
    expect(turn('forester')).toBeGreaterThan(turn('pajero'));
  });

  it.each(CAR_IDS)('A (steer -1) turns the %s left and D (steer +1) turns it right', (carId) => {
    const config = vehicleConfigFor(carId);
    expect(runTurn(config, { entrySpeed: 0, seconds: 3, steer: -1, grip: 1 }).headingChange).toBeGreaterThan(30 * DEGREE);
    expect(runTurn(config, { entrySpeed: 0, seconds: 3, steer: 1, grip: 1 }).headingChange).toBeLessThan(-30 * DEGREE);
  });

  it.each(CAR_IDS)('a full-lock turn at 60 km/h does not flip the %s (C2.9)', (carId) => {
    const turn = runTurn(vehicleConfigFor(carId), { entrySpeed: 60 * KMH, seconds: 5, steer: -1, grip: gripOf(carId, 'road') });
    expect(turn.flipped).toBe(false);
  });

  it('the Pajero leans more than the Forester in the same turn (C2.9)', () => {
    const roll = (carId: CarId): number =>
      runTurn(vehicleConfigFor(carId), { entrySpeed: 60 * KMH, seconds: 5, steer: -1, grip: gripOf(carId, 'road') }).maxRoll;
    expect(roll('pajero')).toBeGreaterThan(roll('forester'));
  });
});

describe('runRollover — a car on its roof (user report on prototype v3)', () => {
  it.each(CAR_IDS)('the %s slides to a stop on its roof, with no wheel on the ground and no engine push', (carId) => {
    const rollover = runRollover(vehicleConfigFor(carId), Math.PI / 2, 10);
    expect(rollover.maxWheelsInContactUpsideDown).toBe(0);
    expect(rollover.speedAfterThreeSeconds).toBeLessThan(rollover.speedAfterLanding);
    expect(rollover.speedAfterThreeSeconds).toBeLessThan(1);
  });

  it.each(CAR_IDS)('after R the %s keeps its heading and W drives it toward its nose', (carId) => {
    const rollover = runRollover(vehicleConfigFor(carId), Math.PI / 2, 10);
    expect(rollover.headingAfterReset).toBeCloseTo(rollover.headingBeforeReset, 6);
    expect(rollover.progressAlongNose).toBeGreaterThan(1);
  });
});
