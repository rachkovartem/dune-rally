// src/render/waterMaterial.test.ts
import { describe, it, expect } from 'vitest';
import { rippleNormalPixels } from './waterMaterial';

const SIZE = 256;

describe('rippleNormalPixels — the lake ripple normal map (R45–R48)', () => {
  const pixels = rippleNormalPixels(SIZE, 11);
  const texel = (row: number, column: number): number[] => Array.from(pixels.slice((row * SIZE + column) * 4, (row * SIZE + column) * 4 + 4));

  it('returns one RGBA texel per pixel', () => {
    expect(pixels).toHaveLength(SIZE * SIZE * 4);
  });

  it('tiles: the last row and column repeat the first ones exactly', () => {
    for (let index = 0; index < SIZE; index += 17) {
      expect(texel(SIZE - 1, index)).toEqual(texel(0, index));
      expect(texel(index, SIZE - 1)).toEqual(texel(index, 0));
    }
  });

  it('decodes every texel to a unit normal facing up out of the water', () => {
    for (let index = 0; index < SIZE * SIZE; index += 131) {
      const [red, green, blue] = Array.from(pixels.slice(index * 4, index * 4 + 3)).map((byte) => (byte / 255) * 2 - 1);
      expect(blue).toBeGreaterThan(0);
      expect(Math.abs(Math.hypot(red, green, blue) - 1)).toBeLessThan(0.02);
    }
  });

  it('gives the same bytes for the same seed and different bytes for another seed', () => {
    expect(rippleNormalPixels(64, 11)).toEqual(rippleNormalPixels(64, 11));
    expect(rippleNormalPixels(64, 11)).not.toEqual(rippleNormalPixels(64, 12));
  });
});
