// shared/protocol.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeCarId, sanitizeInput, sanitizePose } from './protocol';
import { DEFAULT_CAR_ID } from '../src/vehicle/cars';

describe('sanitizeInput', () => {
  it('passes through valid values', () => {
    expect(sanitizeInput({ throttle: 1, brake: 0, steer: -0.5 })).toEqual({ throttle: 1, brake: 0, steer: -0.5 });
  });
  it('clamps out-of-range values', () => {
    expect(sanitizeInput({ throttle: 5, brake: -2, steer: 9 })).toEqual({ throttle: 1, brake: 0, steer: 1 });
  });
  it('zeros missing or non-finite fields', () => {
    expect(sanitizeInput(undefined)).toEqual({ throttle: 0, brake: 0, steer: 0 });
    expect(sanitizeInput({ throttle: NaN, steer: Infinity })).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });
});

describe('sanitizeCarId — the protocol boundary for a car choice (R112, R113)', () => {
  it.each(['forester', 'pajero'])('keeps the known car id "%s"', (carId) => {
    expect(sanitizeCarId(carId)).toBe(carId);
  });

  it.each<[string, unknown]>([
    ['a wrong-case id', 'FORESTER'],
    ['an empty string', ''],
    ['null', null],
    ['undefined (an old client sends no car)', undefined],
    ['a number', 7],
    ['an object', {}],
    ['an id with a trailing space', 'pajero '],
  ])('gives the default car for %s', (_name, raw) => {
    // An old client, a typo or a hostile message still gets a car instead of a crash.
    expect(sanitizeCarId(raw)).toBe(DEFAULT_CAR_ID);
  });
});

describe('sanitizePose — a driver\'s pose from the wire (S1-X)', () => {
  const VALID = { x: 1500, y: 12, z: 2000, qx: 0, qy: 1, qz: 0, qw: 0, vx: 3, vy: 0, vz: -20 };

  it('keeps a valid pose', () => {
    expect(sanitizePose(VALID)).toEqual(VALID);
  });

  it('scales a slightly long rotation back to unit length', () => {
    const pose = sanitizePose({ ...VALID, qy: 1.05 });
    expect(pose).not.toBeNull();
    expect(Math.hypot(pose?.qx ?? 0, pose?.qy ?? 0, pose?.qz ?? 0, pose?.qw ?? 0)).toBeCloseTo(1, 12);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a number', 5],
    ['a missing field', { ...VALID, vz: undefined }],
    ['a NaN field', { ...VALID, x: Number.NaN }],
    ['an infinite field', { ...VALID, y: Number.POSITIVE_INFINITY }],
    ['a field sent as text', { ...VALID, z: '2000' }],
    ['a position far outside any map', { ...VALID, x: 1e6 }],
    ['a speed no car can reach', { ...VALID, vx: 400 }],
    ['a zero rotation', { ...VALID, qy: 0 }],
    ['a rotation twice too long', { ...VALID, qy: 2 }],
  ])('drops %s', (_name, raw) => {
    // A broken or hostile pose must never move the server copy into NaN or out of the world.
    expect(sanitizePose(raw)).toBeNull();
  });
});
