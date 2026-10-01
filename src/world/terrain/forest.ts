// src/world/terrain/forest.ts
// Bosveld: the northwest forest biome valley.
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../rng';
import { smoothstep } from '../blend';
import { BOSVELD } from '../mapLayout';

const forestNoise = createNoise2D(mulberry32(0xf01e57));

/**
 * Normalized distance from Bosveld center in ellipse coordinates.
 * < 1.0 means inside the forest core, > 1.0 means outside.
 */
export function forestRelativeDistance(x: number, z: number): number {
  const dx = (x - BOSVELD.x) / BOSVELD.radiusX;
  const dz = (z - BOSVELD.z) / BOSVELD.radiusZ;
  const dist = Math.hypot(dx, dz);
  // Organic edge noise so the forest edge isn't an exact geometric ellipse
  const warp = 0.12 * forestNoise(x * 0.005, z * 0.005);
  return dist + warp;
}

/**
 * Weight in [0, 1] of the Bosveld forest biome at (x, z).
 * 1 in the deep forest, fading to 0 at the edge.
 */
export function forestWeight(x: number, z: number): number {
  const dist = forestRelativeDistance(x, z);
  if (dist >= 1.0) return 0;
  return 1 - smoothstep(0.65, 1.0, dist);
}

/** Whether the point is within the forest biome. */
export function inForest(x: number, z: number): boolean {
  return forestWeight(x, z) > 0.15;
}
