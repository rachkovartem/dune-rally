// src/world/noise.test.ts
import { describe, it, expect } from 'vitest';
import { createHeightField } from './noise';

describe('createHeightField', () => {
  it('is deterministic for the same seed', () => {
    const a = createHeightField(123);
    const b = createHeightField(123);
    for (const [x, z] of [[0, 0], [12.5, -7.25], [400, 400]]) {
      expect(a(x, z)).toBeCloseTo(b(x, z), 10);
    }
  });

  it('produces different terrain for different seeds', () => {
    const a = createHeightField(1);
    const b = createHeightField(2);
    expect(a(50, 50)).not.toBeCloseTo(b(50, 50), 5);
  });

  it('never exceeds its theoretical bounds', () => {
    // Octave amplitudes (26 + 8 + 2.5 = 36.5) bound the upside; the canyon cut subtracts
    // up to 18. The field can therefore never leave [-54.5, 36.5], whatever the seed.
    const MAX = 36.5;
    const MIN = -54.5;
    const EPS = 1e-6;
    for (const seed of [1, 7, 123, 9999]) {
      const h = createHeightField(seed);
      for (let i = 0; i < 500; i++) {
        const v = h(i * 3.1, i * -2.7);
        expect(v).toBeGreaterThanOrEqual(MIN - EPS);
        expect(v).toBeLessThanOrEqual(MAX + EPS);
      }
    }
  });
});
