// shared/protocol.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeInput, TICK_HZ, ARENA_CHUNKS } from './protocol';

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

describe('constants', () => {
  it('are the documented values', () => {
    expect(TICK_HZ).toBe(30);
    expect(ARENA_CHUNKS).toBe(16);
  });
});
