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

  it('keeps heights within the documented range', () => {
    const h = createHeightField(7);
    for (let i = 0; i < 500; i++) {
      const v = h(i * 3.1, i * -2.7);
      expect(v).toBeGreaterThanOrEqual(-55);
      expect(v).toBeLessThanOrEqual(45);
    }
  });
});
