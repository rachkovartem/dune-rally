// shared/protocol.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeCarId, sanitizeInput } from './protocol';
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
