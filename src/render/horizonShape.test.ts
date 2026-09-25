// src/render/horizonShape.test.ts
import { describe, it, expect } from 'vitest';
import { visualTerrainHeight } from './horizonShape';
import { BASIN_LEVEL, PLAYABLE_MAX, PLAYABLE_MIN, TOWN } from '../world/worldDef';

describe('visualTerrainHeight — the drawn border', () => {
  it('draws exactly the collider everywhere inside the playable rectangle', () => {
    for (const [x, z] of [[TOWN.x, TOWN.z], [PLAYABLE_MIN, 200], [PLAYABLE_MAX, 300], [100, PLAYABLE_MIN]]) {
      expect(visualTerrainHeight(7.25, x, z)).toBe(7.25);
    }
  });

  it('draws exactly the collider at the foot of the border face, where a car can still touch it', () => {
    for (const outside of [0.5, 1, 1.5]) {
      expect(visualTerrainHeight(4.5, PLAYABLE_MIN - outside, 256)).toBe(4.5);
      expect(visualTerrainHeight(4.5, 256, PLAYABLE_MAX + outside)).toBe(4.5);
    }
  });

  it('has no step where the drawn lumps start above the foot', () => {
    const justBelow = visualTerrainHeight(6, PLAYABLE_MIN - 1.5, 180);
    const justAbove = visualTerrainHeight(6, PLAYABLE_MIN - 1.51, 180);
    expect(Math.abs(justAbove - justBelow)).toBeLessThan(0.01);
  });

  it('drops the ground far past the crest below the basin, so the sky mountains show over it', () => {
    for (const [x, z] of [[-40, 256], [256, PLAYABLE_MAX + 70], [-60, -60]]) {
      expect(visualTerrainHeight(20, x, z)).toBeLessThan(BASIN_LEVEL);
    }
  });
});
