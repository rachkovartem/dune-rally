// shared/driveModes.test.ts
// Category 1 (pure): the Pajero's Super Select II — mode changes, axle loads and the centre differential.
import { describe, it, expect } from 'vitest';
import {
  axleLoadShares,
  centreDiffTraction,
  isCentreLocked,
  isDriveMode,
  isLowRange,
  lockedScrubShare,
  nextDriveMode,
  type DriveMode,
} from './driveModes';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';

const KMH = 1 / 3.6;
const pajeroSelect = vehicleConfigFor('pajero').driveSelect;

describe('nextDriveMode — a range change needs the car almost stopped (drive modes)', () => {
  const spec = { rangeChangeMaxSpeed: 5 * KMH };

  it('refuses to go into low range at 5 km/h and says why, and allows it just under', () => {
    expect(nextDriveMode('4HLc', '4LLc', 5 * KMH, spec)).toEqual({ mode: '4HLc', blocked: 'rangeChangeTooFast' });
    expect(nextDriveMode('4HLc', '4LLc', 4.9 * KMH, spec)).toEqual({ mode: '4LLc', blocked: null });
  });

  it('refuses to leave low range at speed, backward as well as forward', () => {
    expect(nextDriveMode('4LLc', '2H', -20 * KMH, spec)).toEqual({ mode: '4LLc', blocked: 'rangeChangeTooFast' });
  });

  it.each<[DriveMode, DriveMode]>([['2H', '4H'], ['4H', '4HLc'], ['4HLc', '2H']])('changes %s → %s at 100 km/h: a high-range change is shift-on-the-fly', (from, to) => {
    expect(nextDriveMode(from, to, 100 * KMH, spec)).toEqual({ mode: to, blocked: null });
  });

  it('keeps the mode with no block when the driver asks for the one it is in', () => {
    expect(nextDriveMode('4LLc', '4LLc', 50 * KMH, spec)).toEqual({ mode: '4LLc', blocked: null });
  });

  it('the Pajero config refuses a range change at walking pace plus a little (under 5 km/h is allowed)', () => {
    if (!pajeroSelect) throw new Error('the Pajero has no selectable drive');
    expect(nextDriveMode('4HLc', '4LLc', 5 * KMH, pajeroSelect).blocked).toBe('rangeChangeTooFast');
    expect(nextDriveMode('4HLc', '4LLc', 4 * KMH, pajeroSelect).blocked).toBeNull();
  });
});

describe('drive mode names from the wire and the mode kinds', () => {
  it.each<[unknown, boolean]>([['2H', true], ['4LLc', true], ['4ll', false], ['', false], [null, false], [4, false]])('isDriveMode(%j) → %s', (value, expected) => {
    expect(isDriveMode(value)).toBe(expected);
  });

  it.each<[DriveMode, boolean, boolean]>([['2H', false, false], ['4H', false, false], ['4HLc', true, false], ['4LLc', true, true]])(
    '%s: centre locked %s, low range %s',
    (mode, locked, low) => {
      expect(isCentreLocked(mode)).toBe(locked);
      expect(isLowRange(mode)).toBe(low);
    },
  );
});

describe('axleLoadShares — the weight moves to the rear up a hill and under throttle', () => {
  const spec = { frontLoadShare: 0.54, comHeight: 0.75 };

  it('keeps the standing split on flat ground', () => {
    const loads = axleLoadShares(spec, 2.8, 0, 1, 0);
    expect(loads.front).toBeCloseTo(0.54, 12);
    expect(loads.front + loads.rear).toBeCloseTo(1, 12);
  });

  it('moves weight to the rear when the nose points up and when the car speeds up', () => {
    const flat = axleLoadShares(spec, 2.8, 0, 1, 0).rear;
    expect(axleLoadShares(spec, 2.8, 0.35, 1, 0).rear).toBeGreaterThan(flat);
    expect(axleLoadShares(spec, 2.8, 0, 1, 0.4).rear).toBeGreaterThan(flat);
    expect(axleLoadShares(spec, 2.8, -0.35, 1, 0).rear).toBeLessThan(flat);
  });

  it('never gives an axle more than all the weight or less than none', () => {
    const steep = axleLoadShares(spec, 2.8, 10, 1, 0);
    expect(steep).toEqual({ front: 0, rear: 1 });
    expect(axleLoadShares(spec, 2.8, -10, 1, 0)).toEqual({ front: 1, rear: 0 });
  });

  it.each([0, -0.5])('gives no load at all to a car on its side or roof (upright %s)', (upright) => {
    expect(axleLoadShares(spec, 2.8, 0.2, upright, 0)).toEqual({ front: 0, rear: 0 });
  });
});

describe('centreDiffTraction — what the centre differential lets both axles pass', () => {
  it('passes the sum of both axle limits when a locked centre drives them', () => {
    expect(centreDiffTraction(3000, 1000, 0.6, Number.POSITIVE_INFINITY)).toBe(4000);
  });

  it('with an open centre, is held back by the axle that runs out of grip first', () => {
    // 40:60: the front limit of 1000 N caps the rear at 1500 N.
    expect(centreDiffTraction(1000, 5000, 0.6, 1)).toBeCloseTo(2500, 9);
  });

  it('with bias 2, moves up to twice the nominal share toward the axle that grips', () => {
    // Nominal rear/front = 1.5; bias 2 allows up to 3 : 1.
    expect(centreDiffTraction(1000, 5000, 0.6, 2)).toBeCloseTo(4000, 9);
    expect(centreDiffTraction(1000, 2500, 0.6, 2)).toBe(3500);
    expect(centreDiffTraction(5000, 500, 0.6, 2)).toBeCloseTo(500 * (1 + 1 / 0.75), 9);
  });

  it('drives one axle alone in 2H (rear share 1) and in a front-driven car (rear share 0)', () => {
    expect(centreDiffTraction(3000, 1000, 1, 2)).toBe(1000);
    expect(centreDiffTraction(3000, 1000, 0, 2)).toBe(3000);
  });

  it('throws for a bias below 1 instead of splitting the force the wrong way', () => {
    expect(() => centreDiffTraction(1000, 1000, 0.6, 0.5)).toThrow('below 1');
  });
});

describe('lockedScrubShare — a locked centre scrubs in a tight turn on grippy ground', () => {
  it.each<[number, number, number, number]>([
    [0, 0.6, 0, 0],
    [0.6, 0.6, 0, 1],
    [0.9, 0.6, 0, 1],
    [0.3, 0.6, 0, 0.5],
    [0.6, 0.6, 1, 0],
    [0.6, 0, 0, 0],
  ])('steer %s of max %s on looseness %s → %s', (steer, maxSteer, looseness, expected) => {
    expect(lockedScrubShare(steer, maxSteer, looseness)).toBeCloseTo(expected, 12);
  });
});
