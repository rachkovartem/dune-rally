// src/world/biome.ts
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';

// Coverage palette (hex; converted to vertex colours by the mesh builder).
export const COVER = {
  water: 0x2f6f8f, // (terrain under the water plane)
  mud: 0x4b3a27,
  beach: 0xe7d3a1,
  sand: 0xd9a559,
  dryGrass: 0xc3b56a,
  grass: 0x5f8a39,
  forest: 0x3b5a29,
  dirt: 0x8a5a31,
  rock: 0x6f6e69,
  snow: 0xeef1f6,
  road: 0x403a33,
  gravel: 0x9a9085,
} as const;

export interface Biome {
  waterLevel: number;
  /** Hex coverage colour at a world point, given its surface height and local slope. */
  colorAt(x: number, z: number, h: number, slope: number): number;
}

export function createBiome(seed: number): Biome {
  // Independent seeded fields (deterministic per world seed).
  const moist = createNoise2D(mulberry32((seed ^ 0x9e3779b1) >>> 0));
  const vary = createNoise2D(mulberry32((seed ^ 0x85ebca6b) >>> 0));
  const road = createNoise2D(mulberry32((seed ^ 0xc2b2ae35) >>> 0));
  const patch = createNoise2D(mulberry32((seed ^ 0x27d4eb2f) >>> 0));

  const waterLevel = -22;

  return {
    waterLevel,
    colorAt(x, z, h, slope) {
      // Winding roads/tracks: a narrow band of a low-frequency field, on gentle dry ground.
      const r = road(x * 0.0016 + 70, z * 0.0016 - 70);
      if (slope < 0.45 && h > waterLevel + 4 && h < 22 && Math.abs(r) < 0.03) return COVER.road;

      // Steep faces are rock (gravel just below the steepest).
      if (slope > 1.05) return COVER.rock;
      if (slope > 0.75) return COVER.gravel;

      // Snow caps on the highest ground.
      if (h > 27) return COVER.snow;

      // Shoreline bands around the water level.
      if (h < waterLevel + 1.2) return COVER.mud;
      if (h < waterLevel + 4) return COVER.beach;

      const m = moist(x * 0.004, z * 0.004) * 0.5 + 0.5; // 0..1 moisture
      const v = vary(x * 0.012, z * 0.012);              // -1..1 local variation
      const p = patch(x * 0.03, z * 0.03);               // -1..1 fine patchiness

      if (m > 0.6) return v > 0.15 ? COVER.forest : COVER.grass;       // wet → green
      if (m > 0.42) return v > 0.05 ? COVER.grass : COVER.dirt;        // mid
      // dry
      if (p > 0.25) return COVER.dirt;
      if (p < -0.25) return COVER.dryGrass;
      return COVER.sand;
    },
  };
}
