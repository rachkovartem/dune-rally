// src/render/sunShadows.test.ts
import { describe, it, expect } from 'vitest';
import { snapToTexel } from './sunShadows';

describe('snapToTexel — keeps the shadow map from crawling (R84–R86)', () => {
  it.each([
    [0, 0.25],
    [1.5, 0.25],
    [-3.75, 0.25],
    [90, 0.04394531],
  ])('leaves %s alone when it already sits on the texel grid of %s', (value, texel) => {
    const onGrid = Math.round(value / texel) * texel;
    expect(snapToTexel(onGrid, texel)).toBe(onGrid);
  });

  it('moves a value to the nearest texel multiple', () => {
    expect(snapToTexel(1.1, 0.25)).toBe(1);
    expect(snapToTexel(1.2, 0.25)).toBe(1.25);
    expect(snapToTexel(-1.2, 0.25)).toBe(-1.25);
  });

  it('gives the same answer every frame for a value exactly between two texels', () => {
    const halfway = 1.125;
    const first = snapToTexel(halfway, 0.25);
    for (let frame = 0; frame < 10; frame++) expect(snapToTexel(halfway, 0.25)).toBe(first);
  });

  it('keeps small moves inside one texel on the same snapped spot', () => {
    // The car moving a few centimetres must not shift the shadow by a texel back and forth.
    const snapped = new Set([2.01, 2.05, 2.1, 1.95, 1.9].map((value) => snapToTexel(value, 0.5)));
    expect(snapped).toEqual(new Set([2]));
  });

  it.each([0, -0.5, Number.NaN])('throws for a texel size of %s', (texel) => {
    expect(() => snapToTexel(1, texel)).toThrow('texel size must be positive');
  });
});
