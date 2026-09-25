// src/world/surfaceSample.test.ts
import { describe, it, expect } from 'vitest';
import { surfaceSampleAt } from './surfaceSample';
import { terrainSurfaceHeight } from './chunkGeometry';
import { createHeightField } from './noise';

describe('surfaceSampleAt (R64–R66)', () => {
  it('reports slope 0 on flat ground', () => {
    expect(surfaceSampleAt(() => 7, 40.3, 90.1)).toEqual({ height: 7, slope: 0 });
  });

  it.each([
    ['along x', (x: number) => 0.5 * x],
    ['along z', (_x: number, z: number) => 0.5 * z],
  ])('reports a slope of 0.5 on ground that rises 0.5 m per metre %s', (_name, rising) => {
    expect(surfaceSampleAt(rising, 100.4, 200.7).slope).toBeCloseTo(0.5, 2);
  });

  it('combines both directions into one steepness', () => {
    expect(surfaceSampleAt((x, z) => 0.3 * x + 0.4 * z, 120.2, 80.9).slope).toBeCloseTo(0.5, 2);
  });

  it('reports the same height the terrain mesh and the colliders are built from', () => {
    // Tyre audio, the grip layer and the tracks read the ground through this one sample.
    const h = createHeightField(1);
    for (const [x, z] of [[256, 256], [133.3, 402.7], [352, 84], [30.5, 300]]) {
      expect(surfaceSampleAt(h, x, z).height).toBe(terrainSurfaceHeight(h, x, z));
    }
  });
});
