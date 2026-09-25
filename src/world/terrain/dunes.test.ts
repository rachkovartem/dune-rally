// src/world/terrain/dunes.test.ts
// Category 1 (pure invariants of the built ground): Wit Duine (plan v3 S2-4, AC9).
import { describe, it, expect } from 'vitest';
import { inDuneField } from './dunes';
import { createHeightField } from '../noise';
import { NURSERY_WHOOPS, WIT_DUINE } from '../mapLayout';
import { WHOOPS_END_X, WHOOPS_START_X } from './crests';

const height = createHeightField(1);
/** The 2 m grid can read a little steeper than the true slope. */
const GRID_ERROR = 0.02;

describe('Wit Duine — dunes a car can drive (S2-4, AC9)', () => {
  it('has no slope over the slip-face limit on a 2 m grid over the whole dune field', () => {
    // Steeper than 0.58 and the Pajero could not climb a slip face at real gravity (plan v3).
    let checked = 0;
    let steepest = 0;
    const { area } = WIT_DUINE;
    for (let x = area.minX; x < area.maxX; x += 2) {
      for (let z = area.minZ; z < area.maxZ; z += 2) {
        if (!inDuneField(x, z)) continue;
        const here = height(x, z);
        steepest = Math.max(steepest, Math.hypot((height(x + 2, z) - here) / 2, (height(x, z + 2) - here) / 2));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100_000);
    expect(steepest).toBeLessThanOrEqual(WIT_DUINE.slipFaceMax + GRID_ERROR);
  });

  it('raises Big Daddy 25 ± 3 m above the lowest ground within 200 m of it', () => {
    const { x, z } = WIT_DUINE.bigDaddy;
    let top = -Infinity;
    for (let dx = -30; dx <= 30; dx += 2) for (let dz = -30; dz <= 30; dz += 2) top = Math.max(top, height(x + dx, z + dz));
    let trough = Infinity;
    for (let degrees = 0; degrees < 360; degrees += 10) {
      for (let reach = 60; reach <= 200; reach += 10) {
        const angle = (degrees * Math.PI) / 180;
        trough = Math.min(trough, height(x + reach * Math.cos(angle), z + reach * Math.sin(angle)));
      }
    }
    expect(top - trough).toBeGreaterThanOrEqual(22);
    expect(top - trough).toBeLessThanOrEqual(28);
  });

  it('rounds every whoop crest on the built ground to at least R 60 (J4)', () => {
    const baseline = 6;
    const z = (NURSERY_WHOOPS.lane.minZ + NURSERY_WHOOPS.lane.maxZ) / 2;
    let crests = 0;
    for (let x = WHOOPS_START_X + baseline; x <= WHOOPS_END_X - baseline; x += 1) {
      const bend = (height(x - baseline, z) - 2 * height(x, z) + height(x + baseline, z)) / (baseline * baseline);
      if (bend < 0) {
        expect(1 / -bend, `x ${x}`).toBeGreaterThanOrEqual(60);
        crests++;
      }
    }
    expect(crests).toBeGreaterThan(0);
  });

  it('counts the dune field only inside its box', () => {
    const { area } = WIT_DUINE;
    expect(inDuneField(area.minX - 1, (area.minZ + area.maxZ) / 2)).toBe(false);
    expect(inDuneField(area.maxX + 1, (area.minZ + area.maxZ) / 2)).toBe(false);
    expect(inDuneField(2400, 1500)).toBe(true);
  });
});
