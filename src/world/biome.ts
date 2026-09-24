// src/world/biome.ts
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';
import * as W from './worldDef';

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
  /** Coverage TYPE at a world point (authored zones + height/slope). */
  coverAt(x: number, z: number, h: number, slope: number): Cover;
  /** Hex coverage colour at a world point. */
  colorAt(x: number, z: number, h: number, slope: number): number;
}

// Wet band around the lake's waterline: covers both the visible shoreline and the submerged bed.
const SHORE_BAND_ABOVE_WATERLEVEL = 0.9;

export function createBiome(seed: number): Biome {
  // A little fixed-feel variation for the open desert ground (kept seed-deterministic).
  const vary = createNoise2D(mulberry32((seed ^ 0x85ebca6b) >>> 0));
  const waterLevel = W.LAKE.waterLevel;

  const coverAt = (x: number, z: number, h: number, slope: number): Cover => {
    // Road network: flat corridor + gravel shoulder, on the carved geometry.
    const rd = W.nearestRoad(x, z);
    if (rd) {
      if (rd.dist < W.ROAD_HALF) return 'road';
      if (rd.dist < W.ROAD_HALF + W.ROAD_SHOULDER) return 'gravel';
    }
    // Hub-town plaza: packed earth between the buildings.
    if (W.townDist(x, z) < W.TOWN.plaza) return 'dirt';

    // Lake shoreline + bed: a wet band from the waterline outward, inside the carve's own
    // footprint only — a low point far from the lake is never mistaken for its shore.
    if (W.lakeDist(x, z) < W.LAKE.radius + W.LAKE.feather && h < waterLevel + SHORE_BAND_ABOVE_WATERLEVEL) {
      return 'mud';
    }

    // Cliff ring + steep faces.
    if (h > W.BORDER_HEIGHT * 0.5) return 'rock';
    if (slope > 0.55) return 'rock';
    if (slope > 0.3) return 'gravel';

    // Mesa plateau / heights.
    if (h > 12) return 'gravel';
    if (h > 7) return 'dryGrass';

    // Themed flats.
    if (W.inSaltFlat(x, z)) return 'beach';     // pale salt straight
    if (W.inDuneSea(x, z)) return 'sand';       // golden dunes

    // Open desert basin with gentle variation.
    const v = vary(x * 0.01, z * 0.01);
    if (v > 0.45) return 'dryGrass';
    if (v < -0.5) return 'dirt';
    return 'sand';
  };

  return {
    waterLevel,
    coverAt,
    colorAt: (x, z, h, slope) => COVER[coverAt(x, z, h, slope)],
  };
}
