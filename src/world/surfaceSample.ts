// src/world/surfaceSample.ts
import { terrainSurfaceHeight } from './chunkGeometry';
import type { Height2D } from './noise';

export interface SurfaceSample {
  height: number;
  slope: number;
}

// One sample feeds both tyre audio and the grip layer, so they always agree on the ground.
export function surfaceSampleAt(heightField: Height2D, x: number, z: number): SurfaceSample {
  const height = terrainSurfaceHeight(heightField, x, z);
  const sampleDistance = 1.5;
  const slope = Math.hypot(
    terrainSurfaceHeight(heightField, x + sampleDistance, z) - terrainSurfaceHeight(heightField, x - sampleDistance, z),
    terrainSurfaceHeight(heightField, x, z + sampleDistance) - terrainSurfaceHeight(heightField, x, z - sampleDistance),
  ) / (2 * sampleDistance);
  return { height, slope };
}
