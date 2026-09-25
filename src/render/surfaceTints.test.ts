// src/render/surfaceTints.test.ts
// Category 1 (pure): the tint step the far layer runs on the CPU. The tint numbers themselves are
// the look and are checked on screenshots (5d).
import { describe, it, expect } from 'vitest';
import { surfaceTintFor, tintColor, type SurfaceTint } from './surfaceTints';

const SAND = { r: 0.34, g: 0.24, b: 0.14 };
const tint = (change: Partial<SurfaceTint>): SurfaceTint =>
  ({ red: 1, green: 1, blue: 1, desaturate: 0, normalStrength: 1, roughness: 1, ...change });

describe('tintColor — the surface tint on a ground colour (S2-5)', () => {
  it('leaves the colour as it is under the plain tint (the open plain looks like its texture)', () => {
    expect(tintColor(SAND, surfaceTintFor('plain'))).toEqual(SAND);
  });

  it('turns a colour fully grey at desaturate 1, keeping its brightness (Rec. 709 luma)', () => {
    const grey = tintColor(SAND, tint({ desaturate: 1 }));
    expect(grey.r).toBeCloseTo(grey.g, 12);
    expect(grey.g).toBeCloseTo(grey.b, 12);
    expect(grey.r).toBeCloseTo(0.2126 * SAND.r + 0.7152 * SAND.g + 0.0722 * SAND.b, 12);
  });

  it('multiplies each channel after the desaturation, not before', () => {
    // Desaturate first, then lift: a grey times (2, 1, 1) is redder than the grey.
    const lifted = tintColor(SAND, tint({ desaturate: 1, red: 2 }));
    const grey = tintColor(SAND, tint({ desaturate: 1 }));
    expect(lifted.r).toBeCloseTo(2 * grey.r, 12);
    expect(lifted.g).toBeCloseTo(grey.g, 12);
  });

  it('moves half way to grey at desaturate 0.5', () => {
    const grey = tintColor(SAND, tint({ desaturate: 1 }));
    const half = tintColor(SAND, tint({ desaturate: 0.5 }));
    expect(half.r).toBeCloseTo((SAND.r + grey.r) / 2, 12);
    expect(half.b).toBeCloseTo((SAND.b + grey.b) / 2, 12);
  });
});
