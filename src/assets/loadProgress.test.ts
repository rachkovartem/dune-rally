// src/assets/loadProgress.test.ts
import { describe, it, expect } from 'vitest';
import { progressFraction } from './loadProgress';

describe('progressFraction — the loading bar (R24–R26)', () => {
  it('is 0 before anything has started', () => {
    expect(progressFraction([])).toBe(0);
  });

  it('leaves out a load whose size is not known yet, instead of reading NaN or Infinity', () => {
    expect(progressFraction([{ loaded: 50, total: 0 }])).toBe(0);
    expect(progressFraction([{ loaded: 50, total: 0 }, { loaded: 25, total: 100 }])).toBe(0.25);
    expect(progressFraction([{ loaded: 5, total: -1 }, { loaded: 10, total: 10 }])).toBe(1);
  });

  it('is 1 when every load is complete', () => {
    expect(progressFraction([{ loaded: 10, total: 10 }, { loaded: 3000, total: 3000 }])).toBe(1);
  });

  it('weighs each load by its size, not by its count', () => {
    expect(progressFraction([{ loaded: 0, total: 900 }, { loaded: 100, total: 100 }])).toBeCloseTo(0.1, 12);
  });
});
