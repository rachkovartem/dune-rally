// src/world/worldDef.test.ts
import { describe, it, expect } from 'vitest';
import {
  WORLD_SIZE, PLAYABLE_MIN, PLAYABLE_MAX, BASIN_LEVEL, LAKE,
  SPAWN, SPAWN_KNOLL, TOWN, MESA,
  mesaHeight, cliffHeight, nearestRoad, townDist, lakeDepthAt, lakeInfluence, borderDepth,
  featuresInChunk, BUILDINGS, RAMPS, LANDMARKS, WORLD_CHUNKS,
} from './worldDef';
import { createHeightField } from './noise';

describe('authored world definition', () => {
  it('keeps every placed feature inside the playable area', () => {
    const all = [...BUILDINGS, ...RAMPS, ...LANDMARKS];
    for (const feature of all) {
      expect(feature.x).toBeGreaterThan(PLAYABLE_MIN);
      expect(feature.x).toBeLessThan(PLAYABLE_MAX);
      expect(feature.z).toBeGreaterThan(PLAYABLE_MIN);
      expect(feature.z).toBeLessThan(PLAYABLE_MAX);
    }
  });

  it('partitions features across the world chunks — each appears exactly once', () => {
    let buildings = 0, ramps = 0, landmarks = 0;
    for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
      for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
        const features = featuresInChunk(cx, cz);
        buildings += features.buildings.length;
        ramps += features.ramps.length;
        landmarks += features.landmarks.length;
      }
    }
    expect(buildings).toBe(BUILDINGS.length);
    expect(ramps).toBe(RAMPS.length);
    expect(landmarks).toBe(LANDMARKS.length);
  });

  it('spawns players on a knoll that stands above the ground around it, away from the town', () => {
    // Replacement (M1): the spawn used to be inside the town plaza, which the user read as a pit
    // (flat bowl, boxes all round). The spawn is now on open ground, higher than its surroundings.
    const h = createHeightField(1);
    expect(townDist(SPAWN.x, SPAWN.z)).toBeGreaterThan(TOWN.plaza + TOWN.skirt);
    expect(h(SPAWN.x, SPAWN.z)).toBeGreaterThan(h(TOWN.x, TOWN.z));
    // Halfway down the knoll's skirt, before the neighbouring mesa starts to rise.
    const skirtRadius = SPAWN_KNOLL.top + SPAWN_KNOLL.skirt / 2;
    for (let step = 0; step < 36; step++) {
      const angle = (step / 36) * Math.PI * 2;
      const x = SPAWN.x + Math.cos(angle) * skirtRadius;
      const z = SPAWN.z + Math.sin(angle) * skirtRadius;
      if (borderDepth(x, z) > 0) continue;
      expect(h(x, z)).toBeLessThan(h(SPAWN.x, SPAWN.z));
    }
  });

  it('raises a flat-topped mesa and zero relief away from it', () => {
    expect(mesaHeight(MESA.x, MESA.z)).toBeCloseTo(MESA.top, 5);
    expect(mesaHeight(MESA.x + 200, MESA.z)).toBe(0);
  });

  it('has no cliff inside the playable rectangle and a wall at least 15 m above the basin at the border', () => {
    // Replacement (M1): the border was lowered from a 46 m wall to open the sky, but stays un-climbable.
    expect(cliffHeight(256, 256)).toBe(0);
    expect(cliffHeight(PLAYABLE_MIN, 256)).toBe(0);
    expect(cliffHeight(2, 256) - BASIN_LEVEL).toBeGreaterThanOrEqual(15);
    expect(cliffHeight(WORLD_SIZE - 2, 256) - BASIN_LEVEL).toBeGreaterThanOrEqual(15);
    expect(cliffHeight(256, 2) - BASIN_LEVEL).toBeGreaterThanOrEqual(15);
  });

  it('starts the border face at the basin floor, with no step at its foot', () => {
    expect(cliffHeight(PLAYABLE_MIN - 0.01, 256)).toBeCloseTo(BASIN_LEVEL, 1);
  });

  it('reports finite, non-negative road distances and ~0 on a road waypoint', () => {
    expect(nearestRoad(TOWN.x, TOWN.z)?.dist).toBeLessThan(1e-6);
    for (let i = 0; i < 200; i++) {
      const distance = nearestRoad((i * 11.7) % WORLD_SIZE, (i * 23.3) % WORLD_SIZE)?.dist;
      expect(distance).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(distance)).toBe(true);
    }
  });
});

describe('lake carve shape (R1–R4)', () => {
  it('is deepest at the centre: the floor height', () => {
    expect(lakeDepthAt(LAKE.x, LAKE.z)).toBeCloseTo(LAKE.floor, 6);
  });

  it('reaches the rim height exactly at the lake radius', () => {
    expect(lakeDepthAt(LAKE.x + LAKE.radius, LAKE.z)).toBeCloseTo(LAKE.rim, 6);
    expect(lakeDepthAt(LAKE.x, LAKE.z - LAKE.radius)).toBeCloseTo(LAKE.rim, 6);
  });

  it('pulls the terrain fully to the carve at the centre', () => {
    expect(lakeInfluence(LAKE.x, LAKE.z)).toBe(1);
  });

  it('has no influence at the end of the feather and beyond', () => {
    const footprint = LAKE.radius + LAKE.feather;
    expect(lakeInfluence(LAKE.x + footprint, LAKE.z)).toBe(0);
    expect(lakeInfluence(LAKE.x + footprint + 50, LAKE.z)).toBe(0);
    expect(lakeInfluence(LAKE.x + footprint - 1, LAKE.z)).toBeGreaterThan(0);
  });
});
