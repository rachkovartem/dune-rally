// src/world/terrain/landforms.test.ts
import { describe, it, expect } from 'vitest';
import { applyLandforms, SPAWN_TOP_LEVEL, TAFELKOP_LEVEL } from './landforms';
import { plainHeight } from './basePlain';
import { DOLERITE_RIDGE, GROOT_KOPPIE, KLEIN_KOPPIES, SPAWN_RISE, TAFELKOP } from '../mapLayout';

const NATURAL = 12;

describe('applyLandforms — the hills on the plain (S1-1)', () => {
  it('leaves the open plain unchanged and names no landform there', () => {
    expect(applyLandforms(NATURAL, 1000, 1500)).toEqual({ height: NATURAL, kind: null, share: 0 });
  });

  it('adds the full koppie height at its top, and nothing at its foot', () => {
    const top = applyLandforms(NATURAL, GROOT_KOPPIE.x, GROOT_KOPPIE.z);
    expect(top).toEqual({ height: NATURAL + GROOT_KOPPIE.height, kind: 'koppie', share: 1 });
    expect(applyLandforms(NATURAL, GROOT_KOPPIE.x + GROOT_KOPPIE.radius, GROOT_KOPPIE.z).height).toBe(NATURAL);
  });

  it('makes every koppie fall away from its top in every direction', () => {
    for (const koppie of KLEIN_KOPPIES) {
      const top = applyLandforms(NATURAL, koppie.x, koppie.z).height;
      for (const share of [0.3, 0.6, 0.9]) {
        const lower = applyLandforms(NATURAL, koppie.x, koppie.z + koppie.radius * share).height;
        expect(lower).toBeLessThan(top);
      }
    }
  });

  it('levels the Tafelkop top and the spawn top whatever the ground under them', () => {
    for (const natural of [0, 30]) {
      expect(applyLandforms(natural, TAFELKOP.x, TAFELKOP.z).height).toBe(TAFELKOP_LEVEL);
      expect(applyLandforms(natural, TAFELKOP.x + 40, TAFELKOP.z - 60).height).toBe(TAFELKOP_LEVEL);
      expect(applyLandforms(natural, SPAWN_RISE.x + 10, SPAWN_RISE.z - 10).height).toBe(SPAWN_TOP_LEVEL);
    }
  });

  it('raises the dolerite ridge 30–35 m on its line and names it', () => {
    const middle = DOLERITE_RIDGE.line[1];
    const sample = applyLandforms(0, middle.x, middle.z);
    expect(sample.kind).toBe('ridge');
    expect(sample.height).toBeGreaterThanOrEqual(DOLERITE_RIDGE.minHeight);
    expect(sample.height).toBeLessThanOrEqual(DOLERITE_RIDGE.maxHeight);
    expect(applyLandforms(0, middle.x, middle.z + DOLERITE_RIDGE.halfWidth + 1).height).toBe(0);
  });
});

describe('the base plain (design §12.1)', () => {
  const averageAlong = (points: readonly [number, number][]): number =>
    points.reduce((sum, [x, z]) => sum + plainHeight(x, z), 0) / points.length;
  const line = (fixed: 'x' | 'z', value: number): [number, number][] =>
    Array.from({ length: 60 }, (_unused, index): [number, number] => (fixed === 'x' ? [value, 300 + index * 41] : [300 + index * 41, value]));

  it('rises toward the east and toward the north, away from the pan in the south-west', () => {
    expect(averageAlong(line('x', 2500))).toBeGreaterThan(averageAlong(line('x', 500)) + 5);
    expect(averageAlong(line('z', 500))).toBeGreaterThan(averageAlong(line('z', 2500)) + 5);
  });

});
