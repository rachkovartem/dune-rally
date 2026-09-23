// src/world/worldDef.test.ts
import { describe, it, expect } from 'vitest';
import {
  WORLD_SIZE, PLAYABLE_MIN, PLAYABLE_MAX,
  SPAWN, TOWN, MESA,
  mesaHeight, cliffHeight, nearestRoad, townDist,
  featuresInChunk, BUILDINGS, RAMPS, LANDMARKS,
} from './worldDef';
import { ARENA_CHUNKS } from '../../shared/protocol';

describe('authored world definition', () => {
  it('keeps every placed feature inside the playable area', () => {
    const all = [...BUILDINGS, ...RAMPS, ...LANDMARKS];
    for (const f of all) {
      expect(f.x).toBeGreaterThan(PLAYABLE_MIN);
      expect(f.x).toBeLessThan(PLAYABLE_MAX);
      expect(f.z).toBeGreaterThan(PLAYABLE_MIN);
      expect(f.z).toBeLessThan(PLAYABLE_MAX);
    }
  });

  it('partitions features across the arena chunks — each appears exactly once', () => {
    let buildings = 0, ramps = 0, landmarks = 0;
    for (let cz = 0; cz < ARENA_CHUNKS; cz++) {
      for (let cx = 0; cx < ARENA_CHUNKS; cx++) {
        const f = featuresInChunk(cx, cz);
        buildings += f.buildings.length;
        ramps += f.ramps.length;
        landmarks += f.landmarks.length;
      }
    }
    expect(buildings).toBe(BUILDINGS.length);
    expect(ramps).toBe(RAMPS.length);
    expect(landmarks).toBe(LANDMARKS.length);
  });

  it('spawns players inside the flat town plaza', () => {
    expect(townDist(SPAWN.x, SPAWN.z)).toBeLessThan(TOWN.plaza);
  });

  it('raises a flat-topped mesa and zero relief away from it', () => {
    expect(mesaHeight(MESA.x, MESA.z)).toBeCloseTo(MESA.top, 5);
    expect(mesaHeight(MESA.x + 200, MESA.z)).toBe(0);
  });

  it('has no cliff inside the playable rectangle and a wall at the border', () => {
    expect(cliffHeight(256, 256)).toBe(0);
    expect(cliffHeight(2, 256)).toBeGreaterThan(20);
    expect(cliffHeight(WORLD_SIZE - 2, 256)).toBeGreaterThan(20);
  });

  it('reports finite, non-negative road distances and ~0 on a road waypoint', () => {
    expect(nearestRoad(TOWN.x, TOWN.z)!.dist).toBeLessThan(1e-6); // town centre is a road node
    for (let i = 0; i < 200; i++) {
      const d = nearestRoad((i * 11.7) % WORLD_SIZE, (i * 23.3) % WORLD_SIZE)!.dist;
      expect(d).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(d)).toBe(true);
    }
  });
});
