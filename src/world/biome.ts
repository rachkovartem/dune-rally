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
  snow: 0xcdd4da,
  road: 0x403a33,
  gravel: 0x9a9085,
} as const;

export type Cover = keyof typeof COVER;

export interface Biome {
  waterLevel: number;
  /** Coverage TYPE at a world point (height + slope + seeded fields). */
  coverAt(x: number, z: number, h: number, slope: number): Cover;
  /** Hex coverage colour at a world point. */
  colorAt(x: number, z: number, h: number, slope: number): number;
}

export function createBiome(seed: number): Biome {
  const moist = createNoise2D(mulberry32((seed ^ 0x9e3779b1) >>> 0));
  const vary = createNoise2D(mulberry32((seed ^ 0x85ebca6b) >>> 0));
  const road = createNoise2D(mulberry32((seed ^ 0xc2b2ae35) >>> 0));
  const patch = createNoise2D(mulberry32((seed ^ 0x27d4eb2f) >>> 0));

  const waterLevel = -22;

  const coverAt = (x: number, z: number, h: number, slope: number): Cover => {
    // Winding tracks: a narrow band of a low-frequency field on gentle, dry ground.
    const r = road(x * 0.0016 + 70, z * 0.0016 - 70);
    if (slope < 0.45 && h > waterLevel + 4 && h < 22 && Math.abs(r) < 0.03) return 'road';

    if (slope > 1.05) return 'rock';
    if (slope > 0.75) return 'gravel';
    if (h > 31) return 'snow';

    if (h < waterLevel + 1.2) return 'mud';
    if (h < waterLevel + 4) return 'beach';

    const m = moist(x * 0.004, z * 0.004) * 0.5 + 0.5; // 0..1 moisture
    const v = vary(x * 0.012, z * 0.012);              // -1..1 variation
    const p = patch(x * 0.03, z * 0.03);               // -1..1 fine patchiness

    if (m > 0.6) return v > 0.15 ? 'forest' : 'grass';
    if (m > 0.42) return v > 0.05 ? 'grass' : 'dirt';
    if (p > 0.25) return 'dirt';
    if (p < -0.25) return 'dryGrass';
    return 'sand';
  };

  return {
    waterLevel,
    coverAt,
    colorAt: (x, z, h, slope) => COVER[coverAt(x, z, h, slope)],
  };
}
