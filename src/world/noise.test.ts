// src/world/noise.test.ts
import { describe, it, expect } from 'vitest';
import { createHeightField } from './noise';
import {
  MESA, BORDER_HEIGHT, WORLD_SIZE, TOWN, LAKE, BASIN_LEVEL, PLAYABLE_MIN, PLAYABLE_MAX,
  lakeDist, groundLevel,
} from './worldDef';

const LAKE_FOOTPRINT = LAKE.radius + LAKE.feather;

/** Largest height change per metre between grid neighbours `step` apart, over the points `include` accepts. */
function steepestSlope(h: (x: number, z: number) => number, include: (x: number, z: number) => boolean, step: number): number {
  let steepest = 0;
  for (let x = 0; x < WORLD_SIZE; x += step) {
    for (let z = 0; z < WORLD_SIZE; z += step) {
      if (!include(x, z)) continue;
      const here = h(x, z);
      steepest = Math.max(steepest, Math.hypot(h(x + step, z) - here, h(x, z + step) - here) / step);
    }
  }
  return steepest;
}

describe('createHeightField (authored world)', () => {
  it('is deterministic', () => {
    const a = createHeightField(123);
    const b = createHeightField(123);
    for (const [x, z] of [[0, 0], [256, 256], [400, 150]]) {
      expect(a(x, z)).toBeCloseTo(b(x, z), 10);
    }
  });

  it('is the SAME unique world regardless of seed', () => {
    const a = createHeightField(1);
    const b = createHeightField(99999);
    for (const [x, z] of [[100, 100], [256, 96], [430, 360]]) {
      expect(a(x, z)).toBeCloseTo(b(x, z), 10);
    }
  });

  it('raises a mesa plateau', () => {
    const h = createHeightField(1);
    expect(h(MESA.x, MESA.z)).toBeGreaterThan(MESA.top - 2);
  });

  it('grades the whole town plaza flat, at the basin\'s own ground level (no pit)', () => {
    // Replacement (M1): the plaza used to be flattened to 0 below the basin floor, so the town read
    // as a hole the player spawned in. It now sits at the local ground level.
    const h = createHeightField(1);
    expect(h(TOWN.x, TOWN.z)).toBeCloseTo(groundLevel(TOWN.x, TOWN.z), 6);
    expect(h(TOWN.x, TOWN.z)).toBeCloseTo(BASIN_LEVEL, 6);
    for (let dx = -TOWN.plaza; dx <= TOWN.plaza; dx += 2) {
      for (let dz = -TOWN.plaza; dz <= TOWN.plaza; dz += 2) {
        if (Math.hypot(dx, dz) >= TOWN.plaza) continue;
        expect(h(TOWN.x + dx, TOWN.z + dz)).toBeCloseTo(h(TOWN.x, TOWN.z), 6);
      }
    }
  });

  it('walls the world with un-climbable cliffs at the border', () => {
    const h = createHeightField(1);
    expect(h(4, 256)).toBeGreaterThan(BORDER_HEIGHT - 5);
    expect(h(WORLD_SIZE - 4, 256)).toBeGreaterThan(BORDER_HEIGHT - 5);
  });

  it('stays within sane bounds across the map; nothing is lower than the lake floor', () => {
    // Replacement: the old lower bound (-2) predates the lake, whose floor is the lowest authored point.
    const h = createHeightField(1);
    for (let i = 0; i < 600; i++) {
      const x = (i * 17.3) % WORLD_SIZE;
      const z = (i * 29.7) % WORLD_SIZE;
      const height = h(x, z);
      expect(height).toBeGreaterThanOrEqual(LAKE.floor);
      expect(height).toBeLessThanOrEqual(BORDER_HEIGHT + 2);
    }
  });
});

describe('createHeightField — the lake carve (R5–R8)', () => {
  const h = createHeightField(1);

  it('puts the lake centre below the water level', () => {
    expect(h(LAKE.x, LAKE.z)).toBeLessThan(LAKE.waterLevel);
  });

  it('blends back into the natural ground with no step at the edge of its footprint', () => {
    // A hard cut at radius + feather would be a small cliff a car hits on the way to the lake.
    for (const angle of [0, Math.PI / 3, Math.PI, 4.5]) {
      const heightAt = (distance: number): number =>
        h(LAKE.x + Math.cos(angle) * distance, LAKE.z + Math.sin(angle) * distance);
      expect(Math.abs(heightAt(LAKE_FOOTPRINT - 0.01) - heightAt(LAKE_FOOTPRINT + 0.01))).toBeLessThan(0.02);
    }
  });

  it('keeps every playable point outside the lake footprint above the water level (no other water)', () => {
    for (let x = PLAYABLE_MIN; x <= PLAYABLE_MAX; x += 4) {
      for (let z = PLAYABLE_MIN; z <= PLAYABLE_MAX; z += 4) {
        if (lakeDist(x, z) < LAKE_FOOTPRINT) continue;
        expect(h(x, z)).toBeGreaterThan(LAKE.waterLevel);
      }
    }
  });

  it('keeps the lake banks gentler than the mesa skirt, so a car can drive in and out', () => {
    const inLake = (x: number, z: number): boolean => lakeDist(x, z) < LAKE_FOOTPRINT;
    const onMesaSkirt = (x: number, z: number): boolean => {
      const distance = Math.hypot(x - MESA.x, z - MESA.z);
      return distance > MESA.radius && distance < MESA.radius + MESA.skirt;
    };
    expect(steepestSlope(h, inLake, 0.5)).toBeLessThan(steepestSlope(h, onMesaSkirt, 0.5));
  });
});
