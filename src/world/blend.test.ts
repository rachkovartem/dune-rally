// src/world/blend.test.ts
import { describe, it, expect } from 'vitest';
import { clamp, lerp, smoothstep } from './blend';

describe('smoothstep', () => {
  it.each([
    ['at and below the lower edge', -5, 0],
    ['at the lower edge', 10, 0],
    ['half way', 15, 0.5],
    ['at the upper edge', 20, 1],
    ['past the upper edge', 99, 1],
  ])('gives the blend %s', (_name, value, expected) => {
    expect(smoothstep(10, 20, value)).toBe(expected);
  });

  it('rises the other way when the edges are given high to low', () => {
    expect(smoothstep(20, 10, 12)).toBeGreaterThan(smoothstep(20, 10, 18));
  });

  it('starts and ends flat, so a blended edge has no crease', () => {
    const slopeAt = (value: number): number => (smoothstep(0, 1, value + 1e-6) - smoothstep(0, 1, value - 1e-6)) / 2e-6;
    expect(slopeAt(1e-5)).toBeLessThan(1e-3);
    expect(slopeAt(1 - 1e-5)).toBeLessThan(1e-3);
  });
});

describe('lerp and clamp', () => {
  it('mixes from one value to the other, and extrapolates past the ends', () => {
    expect(lerp(4, 8, 0)).toBe(4);
    expect(lerp(4, 8, 1)).toBe(8);
    expect(lerp(4, 8, 0.25)).toBe(5);
    expect(lerp(4, 8, 2)).toBe(12);
  });

  it('keeps a value between the limits, and leaves one inside them unchanged', () => {
    expect(clamp(-3, 0, 1)).toBe(0);
    expect(clamp(7, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });
});
