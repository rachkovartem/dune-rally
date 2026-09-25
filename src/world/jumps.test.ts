// src/world/jumps.test.ts
// Category 1 (pure): the two formulas behind the jump table at real gravity, and the table's own
// promises (plan v3 S2-1, S3-1).
import { describe, it, expect } from 'vitest';
import { JUMPS, ballisticRange, crestLiftSpeed } from './jumps';
import { DIE_SPRONG, EERSTE_BULT, GRUISGAT } from './mapLayout';
import { WORLD_GRAVITY } from '../../shared/drivetrain';

const KMH = 1 / 3.6;

describe('crestLiftSpeed — where a crest makes the wheels light', () => {
  it('lifts the wheels over the R 100 Eerste Bult between 110 and 115 km/h (the jump table)', () => {
    const lift = crestLiftSpeed(100, WORLD_GRAVITY) / KMH;
    expect(lift).toBeGreaterThanOrEqual(110);
    expect(lift).toBeLessThanOrEqual(115);
  });

  it('is 0 on a crest of radius 0 and grows with the radius', () => {
    expect(crestLiftSpeed(0, WORLD_GRAVITY)).toBe(0);
    expect(crestLiftSpeed(300, WORLD_GRAVITY)).toBeGreaterThan(crestLiftSpeed(100, WORLD_GRAVITY));
  });

  it.each<[number, number]>([[-1, 9.81], [Number.NaN, 9.81], [100, 0], [100, -9.81]])('throws for radius %s and gravity %s', (radius, gravity) => {
    expect(() => crestLiftSpeed(radius, gravity)).toThrow('bad radius');
  });
});

describe('ballisticRange — how far a car flies off a lip', () => {
  it('flies nowhere at speed 0', () => {
    expect(ballisticRange(0, 0.3, 0, WORLD_GRAVITY)).toBe(0);
  });

  it('flies nowhere off a flat lip onto ground at the same height', () => {
    expect(ballisticRange(30, 0, 0, WORLD_GRAVITY)).toBe(0);
  });

  it('flies v²/g at 45 degrees onto ground at the same height (the textbook check)', () => {
    expect(ballisticRange(20, Math.PI / 4, 0, WORLD_GRAVITY)).toBeCloseTo(400 / WORLD_GRAVITY, 9);
  });

  it('gives 0 for a landing higher than the car ever gets', () => {
    expect(ballisticRange(5, 0.1, -20, WORLD_GRAVITY)).toBe(0);
  });

  it('clears Die Sprong\'s 30 m gap at 85 km/h and falls short at 80 km/h (J6)', () => {
    const angle = Math.atan(DIE_SPRONG.rampSlope);
    expect(ballisticRange(85 * KMH, angle, DIE_SPRONG.farBankDrop, WORLD_GRAVITY)).toBeGreaterThanOrEqual(DIE_SPRONG.gap);
    expect(ballisticRange(80 * KMH, angle, DIE_SPRONG.farBankDrop, WORLD_GRAVITY)).toBeLessThan(DIE_SPRONG.gap);
  });

  it.each<[number, number, number, number]>([[-1, 0, 0, 9.81], [10, Number.NaN, 0, 9.81], [10, 0, Number.POSITIVE_INFINITY, 9.81], [10, 0, 0, 0]])(
    'throws for speed %s, angle %s, height %s, gravity %s',
    (speed, angle, launchHeight, gravity) => {
      expect(() => ballisticRange(speed, angle, launchHeight, gravity)).toThrow('bad input');
    },
  );
});

describe('JUMPS — the table the map is built to', () => {
  it('gives J1 a straight landing at least 3 times the flight at 145 km/h, its "overdo" speed', () => {
    const j1 = JUMPS.find((jump) => jump.id === 'J1');
    const flight = ballisticRange(145 * KMH, Math.atan(EERSTE_BULT.maxGrade), 0, WORLD_GRAVITY);
    expect(flight).toBeGreaterThan(0);
    expect(j1?.landingLength).toBeGreaterThanOrEqual(3 * flight);
  });

  it('gives every quarry heap (J7) at least 55 m of clear landing ahead of its lip', () => {
    const heaps = JUMPS.filter((jump) => jump.id === 'J7');
    expect(heaps).toHaveLength(GRUISGAT.heaps.length);
    for (const heap of heaps) expect(heap.landingLength).toBeGreaterThanOrEqual(GRUISGAT.minLanding);
  });

  it('rounds the whoops (J4) to at least R 60, so the rhythm at 70–95 km/h keeps the wheels down', () => {
    const whoops = JUMPS.find((jump) => jump.id === 'J4');
    expect(whoops?.radius).toBeGreaterThanOrEqual(60);
  });

  it('gives a crest radius to the crest jumps only, never to a lip', () => {
    for (const jump of JUMPS) expect(jump.radius === null).toBe(['gapJump', 'heapKicker', 'rockStep'].includes(jump.kind));
  });
});
