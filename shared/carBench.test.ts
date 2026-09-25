// shared/carBench.test.ts
// The car comparison promises of spec v4 (C2.6–C2.12) and the user's real-car targets, measured
// on the same driving model the game runs. Bands are relations or "≈" ranges, not tuned numbers.
import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  chassisBottomHeight, chassisBottomOf, createBenchCar, runBraking, runCrest, runDropSettle, runHillClimb, runRidge,
  runRollover, runStraightLine, runTurn, speedAt, type StraightLineResult,
} from './carBench';
import type { Quaternion } from './vehiclePhysics';
import { FULL_GRIP, groundGripFor, type GroundGrip } from './terrainGrip';
import { CAR_IDS, type CarId } from '../src/vehicle/cars';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';

const KMH = 1 / 3.6;
const DEGREE = Math.PI / 180;

type Surface = 'road' | 'sand' | 'rock';
// Replacement (S2-3): the bench takes the whole ground (grip and rolling resistance), not a grip number.
const gripOf = (carId: CarId, surface: Surface): GroundGrip => groundGripFor(surface, vehicleConfigFor(carId));

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
    expect(runStraightLine(vehicleConfigFor('forester'), FULL_GRIP, 20).topSpeed)
      .toBeGreaterThan(runStraightLine(vehicleConfigFor('pajero'), FULL_GRIP, 20).topSpeed);
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
    const short = runStraightLine(vehicleConfigFor('pajero'), FULL_GRIP, 2);
    expect(short.timeTo100).toBeNull();
    expect(short.topSpeed).toBeLessThan(100 * KMH);
  });
});

describe('speedAt', () => {
  it('reads the speed at the end of the run', () => {
    const run = runStraightLine(vehicleConfigFor('forester'), FULL_GRIP, 2);
    expect(speedAt(run, 2)).toBe(run.samples[run.samples.length - 1].speed);
  });

  it('throws when the run did not last that long, instead of reading the last sample', () => {
    const run = runStraightLine(vehicleConfigFor('forester'), FULL_GRIP, 2);
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
      runTurn(vehicleConfigFor(carId), { entrySpeed: 0, seconds: 5, steer: -1, ground: gripOf(carId, 'road') }).headingChange;
    expect(turn('forester')).toBeGreaterThan(turn('pajero'));
  });

  it.each(CAR_IDS)('A (steer -1) turns the %s left and D (steer +1) turns it right', (carId) => {
    const config = vehicleConfigFor(carId);
    expect(runTurn(config, { entrySpeed: 0, seconds: 3, steer: -1, ground: FULL_GRIP }).headingChange).toBeGreaterThan(30 * DEGREE);
    expect(runTurn(config, { entrySpeed: 0, seconds: 3, steer: 1, ground: FULL_GRIP }).headingChange).toBeLessThan(-30 * DEGREE);
  });

  it.each(CAR_IDS)('a full-lock turn at 60 km/h does not flip the %s (C2.9)', (carId) => {
    const turn = runTurn(vehicleConfigFor(carId), { entrySpeed: 60 * KMH, seconds: 5, steer: -1, ground: gripOf(carId, 'road') });
    expect(turn.flipped).toBe(false);
  });

  it('the Pajero leans more than the Forester in the same turn (C2.9)', () => {
    const roll = (carId: CarId): number =>
      runTurn(vehicleConfigFor(carId), { entrySpeed: 60 * KMH, seconds: 5, steer: -1, ground: gripOf(carId, 'road') }).maxRoll;
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

describe('real gravity — crests, climbs and drops (plan v3 S0-4)', () => {
  it.each(CAR_IDS)('keeps at least two %s wheels on a 100 m crest at 100 km/h, and does not flip', (carId) => {
    const crest = runCrest(vehicleConfigFor(carId), 100, 100 * KMH);
    expect(crest.minWheelsInContact).toBeGreaterThanOrEqual(2);
    expect(crest.flipped).toBe(false);
  });

  it.each(CAR_IDS)('stops the %s on a rock face of slope 0.8 (what keeps the border a border, AC6)', (carId) => {
    const climb = runHillClimb(vehicleConfigFor(carId), 0.8, gripOf(carId, 'rock'));
    expect(climb.reachedTop).toBe(false);
  });

  it.each(CAR_IDS)('stops the %s on a slope of 1.2 even with road grip: the tyres press less on a slope', (carId) => {
    // Regression: without cos θ in the normal force a car climbed 50° walls at real gravity.
    expect(runHillClimb(vehicleConfigFor(carId), 1.2, FULL_GRIP).reachedTop).toBe(false);
  });

  it('lets the Pajero climb a 0.58 sand slip face and stops the Forester on it', () => {
    expect(runHillClimb(vehicleConfigFor('pajero'), 0.58, gripOf('pajero', 'sand')).reachedTop).toBe(true);
    expect(runHillClimb(vehicleConfigFor('forester'), 0.58, gripOf('forester', 'sand')).reachedTop).toBe(false);
  });

  it.each(CAR_IDS)('settles the %s within 1.5 s of a 0.3 m drop, bouncing less than 3 cm', (carId) => {
    const drop = runDropSettle(vehicleConfigFor(carId), 0.3);
    expect(drop.settleSeconds).toBeLessThan(1.5);
    expect(drop.maxBounce).toBeLessThan(0.03);
  });

  it.each<[CarId, number]>([
    ['forester', 4],
    ['pajero', 6],
    ['elantra', 3.5],
  ])('keeps the %s roll at 60 km/h full lock within %s°', (carId, limitDegrees) => {
    const turn = runTurn(vehicleConfigFor(carId), { entrySpeed: 60 * KMH, seconds: 5, steer: -1, ground: gripOf(carId, 'road') });
    expect(turn.maxRoll).toBeLessThanOrEqual(limitDegrees * DEGREE);
  });
});

describe('the Elantra: front-wheel drive and a low belly (E2)', () => {
  it('climbs a 0.35 road slope, so every road on the map stays open to it', () => {
    expect(runHillClimb(vehicleConfigFor('elantra'), 0.35, gripOf('elantra', 'road')).reachedTop).toBe(true);
  });

  it('cannot climb a 0.4 rock slope that the AWD Forester climbs', () => {
    // Regression: this is what makes a front-driven road car different from the other two.
    expect(runHillClimb(vehicleConfigFor('elantra'), 0.4, gripOf('elantra', 'rock')).reachedTop).toBe(false);
    expect(runHillClimb(vehicleConfigFor('forester'), 0.4, gripOf('forester', 'rock')).reachedTop).toBe(true);
  });

  it('cannot climb a 0.25 dune sand slope that the Forester climbs', () => {
    expect(runHillClimb(vehicleConfigFor('elantra'), 0.25, gripOf('elantra', 'sand')).reachedTop).toBe(false);
    expect(runHillClimb(vehicleConfigFor('forester'), 0.25, gripOf('forester', 'sand')).reachedTop).toBe(true);
  });

  it('hangs on its belly on a sharp 14° ridge at 10 km/h, where the Forester crosses', () => {
    // Replacement (E2 follow-up): with the belly raised to the visible sill (0.2 m) it hangs from 13°, not 12°.
    const elantra = runRidge(vehicleConfigFor('elantra'), 14, 10 * KMH);
    expect(elantra.crossed).toBe(false);
    expect(elantra.bellyContactSeconds).toBeGreaterThan(0);
    const forester = runRidge(vehicleConfigFor('forester'), 14, 10 * KMH);
    expect(forester.crossed).toBe(true);
    expect(forester.bellyContactSeconds).toBe(0);
  });

  it('sits with its belly lower than the Forester\'s, and never touches flat ground in a 0.3 m drop', () => {
    const bellyOf = (carId: CarId): number => {
      const car = createBenchCar(vehicleConfigFor(carId));
      return chassisBottomOf(car.vehicle, vehicleConfigFor(carId));
    };
    expect(bellyOf('elantra')).toBeLessThan(bellyOf('forester'));
    expect(runDropSettle(vehicleConfigFor('elantra'), 0.3).minChassisClearance).toBeGreaterThan(0);
  });

  it('loses more speed to the Forester on sand than on the road: its weakness is the ground, not the road', () => {
    const gapTo = (surface: Surface): number => 1 - speedAt(straightRun('elantra', surface), 5) / speedAt(straightRun('forester', surface), 5);
    expect(gapTo('sand')).toBeGreaterThan(gapTo('road'));
  });

  it('rolls less than the Forester and turns at least as far at 60 km/h full lock', () => {
    const turnOf = (carId: CarId): { headingChange: number; maxRoll: number } =>
      runTurn(vehicleConfigFor(carId), { entrySpeed: 60 * KMH, seconds: 5, steer: -1, ground: gripOf(carId, 'road') });
    const elantra = turnOf('elantra');
    const forester = turnOf('forester');
    expect(elantra.maxRoll).toBeLessThan(forester.maxRoll);
    expect(elantra.headingChange).toBeGreaterThanOrEqual(forester.headingChange);
  });
});

describe('chassisBottomHeight — the lowest corner of the chassis box', () => {
  const BOX = { hx: 0.8, hy: 0.5, hz: 2 };
  const centre = { x: 3, y: 2, z: -1 };
  const aboutAxis = (axis: 'x' | 'z', degrees: number): Quaternion => {
    const half = (degrees * Math.PI) / 360;
    return { x: axis === 'x' ? Math.sin(half) : 0, y: 0, z: axis === 'z' ? Math.sin(half) : 0, w: Math.cos(half) };
  };

  it.each<[string, Quaternion, number]>([
    ['upright', { x: 0, y: 0, z: 0, w: 1 }, BOX.hy],
    ['upside down', aboutAxis('z', 180), BOX.hy],
    ['on its side', aboutAxis('z', 90), BOX.hx],
    ['standing on its nose', aboutAxis('x', 90), BOX.hz],
    ['rolled 45°', aboutAxis('z', 45), (BOX.hx + BOX.hy) * Math.SQRT1_2],
    ['pitched 30°', aboutAxis('x', 30), BOX.hy * Math.cos(Math.PI / 6) + BOX.hz * Math.sin(Math.PI / 6)],
  ])('reaches down from the centre by the box half-sizes along each axis (%s)', (_name, rotation, reach) => {
    expect(chassisBottomHeight(centre, rotation, BOX)).toBeCloseTo(centre.y - reach, 9);
  });
});
