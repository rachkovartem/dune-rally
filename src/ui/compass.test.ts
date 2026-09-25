// src/ui/compass.test.ts
import { describe, it, expect } from 'vitest';
import { compassHeadingDegrees, compassLabelAt } from './compass';

describe('compassHeadingDegrees — 0 is north (−z), 90 is east (+x) (S1-3)', () => {
  it.each([
    ['north', 0, -1, 0],
    ['east', 1, 0, 90],
    ['south', 0, 1, 180],
    ['west', -1, 0, 270],
    ['north-east', 1, -1, 45],
    ['north-west', -1, -1, 315],
  ])('reads %s', (_name, forwardX, forwardZ, degrees) => {
    expect(compassHeadingDegrees(forwardX, forwardZ)).toBeCloseTo(degrees, 9);
  });

  it('does not depend on the length of the direction', () => {
    expect(compassHeadingDegrees(0.001, 0.001)).toBeCloseTo(compassHeadingDegrees(50, 50), 9);
  });

  it('stays below 360 just west of north, never reading 360', () => {
    const heading = compassHeadingDegrees(-1e-12, -1);
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(heading).toBeLessThan(360);
  });

  it('throws for a zero direction: it has no heading', () => {
    expect(() => compassHeadingDegrees(0, 0)).toThrow('no heading');
  });
});

describe('compassLabelAt — the letters on the strip (S1-3)', () => {
  it.each([
    [0, 'N'], [45, 'NE'], [180, 'S'], [315, 'NW'],
  ])('puts the letter at %s°', (degrees, label) => {
    expect(compassLabelAt(degrees)).toBe(label);
  });

  it('shows no letter between the letters', () => {
    expect(compassLabelAt(7)).toBeNull();
    expect(compassLabelAt(44.9)).toBeNull();
  });

  it('wraps headings outside one turn, so the strip repeats past north on both sides', () => {
    expect(compassLabelAt(360)).toBe('N');
    expect(compassLabelAt(-45)).toBe('NW');
    expect(compassLabelAt(-360)).toBe('N');
    expect(compassLabelAt(405)).toBe('NE');
  });
});
