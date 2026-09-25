// src/render/horizonShape.test.ts
// Replacement (S1-3): the drawn border is measured from the face foot (borderFaceDepth) and the map
// edge (borderDistance) of Klipfontein, not from the old playable rectangle.
import { describe, it, expect } from 'vitest';
import { visualTerrainHeight } from './horizonShape';
import { borderDistance, borderFaceDepth, SPAWN } from '../world/worldDef';
import { createHeightField } from '../world/noise';
import { BORDER, MAP_SIZE } from '../world/mapLayout';

const height = createHeightField(1);
const drawn = (x: number, z: number): number => visualTerrainHeight(height(x, z), x, z);

describe('visualTerrainHeight — the drawn border (S1-3)', () => {
  it('draws exactly the collider in the valley', () => {
    for (const [x, z] of [[SPAWN.x, SPAWN.z], [1536, 1536], [400, 2500], [2800, 600]]) {
      expect(drawn(x, z)).toBe(height(x, z));
    }
  });

  it('draws exactly the collider up to 1.5 m past the face foot, where a car can still touch it', () => {
    for (const pastFoot of [0, 0.5, 1, 1.5]) {
      for (const [x, z] of [[1200, BORDER.faceFoot - pastFoot], [MAP_SIZE - BORDER.faceFoot + pastFoot, 1800]]) {
        expect(borderFaceDepth(x, z)).toBeCloseTo(pastFoot, 6);
        expect(drawn(x, z)).toBe(height(x, z));
      }
    }
  });

  it('has no step where the drawn lumps start above the foot', () => {
    const x = 1300;
    for (const pastFoot of [1.5, 1.6, 2, 3]) {
      const z = BORDER.faceFoot - pastFoot;
      const nextZ = z - 0.01;
      expect(Math.abs(drawn(x, nextZ) - drawn(x, z) - (height(x, nextZ) - height(x, z)))).toBeLessThan(0.01);
    }
  });

  it('drops the ground far past the map edge below the valley floor, so the sky mountains show over the crest', () => {
    const valleyFloor = height(1536, 1536);
    for (const [x, z] of [[-40, 1500], [1500, MAP_SIZE + 70], [-60, -60]]) {
      expect(borderDistance(x, z)).toBeLessThan(-30);
      expect(drawn(x, z)).toBeLessThan(valleyFloor);
      expect(drawn(x, z)).toBeLessThan(height(x, z));
    }
  });
});
