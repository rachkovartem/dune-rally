// src/world/terrain/forest.test.ts
import { describe, it, expect } from 'vitest';
import { forestWeight, inForest } from './forest';
import { BOSVELD } from '../mapLayout';

describe('forest biome (Bosveld)', () => {
  it('gives high weight inside the forest core', () => {
    const weight = forestWeight(BOSVELD.x, BOSVELD.z);
    expect(weight).toBeGreaterThan(0.9);
    expect(inForest(BOSVELD.x, BOSVELD.z)).toBe(true);
  });

  it('fades to zero well outside the forest', () => {
    // East at spawn
    expect(forestWeight(1560, 2000)).toBe(0);
    expect(inForest(1560, 2000)).toBe(false);
    // Far south at pan
    expect(forestWeight(1050, 2560)).toBe(0);
    expect(inForest(1050, 2560)).toBe(false);
    // Dunes in east
    expect(forestWeight(2500, 1400)).toBe(0);
    expect(inForest(2500, 1400)).toBe(false);
  });
});
