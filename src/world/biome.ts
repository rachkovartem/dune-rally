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

function isCover(value: string): value is Cover {
  return Object.hasOwn(COVER, value);
}

/** Every cover in a fixed order, so a cover can travel as a small number (a worker buffer). */
export const COVER_IDS: readonly Cover[] = Object.keys(COVER).filter(isCover);

const INDEX_BY_COVER = new Map<Cover, number>(COVER_IDS.map((cover, index) => [cover, index]));

export function coverIndex(cover: Cover): number {
  const index = INDEX_BY_COVER.get(cover);
  if (index === undefined) throw new Error(`biome: cover "${cover}" has no index`);
  return index;
}

export function coverFromIndex(index: number): Cover {
  const cover = COVER_IDS[index];
  if (cover === undefined) throw new Error(`biome: no cover has index ${index}`);
  return cover;
}

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
    const rd = W.nearestRoad(x, z, W.ROAD_HALF + W.ROAD_SHOULDER);
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

    // Border slope + steep faces.
    if (W.borderDepth(x, z) > 0) return 'rock';
    if (slope > 0.55) return 'rock';
    if (slope > 0.3) return 'gravel';

    // Mesa plateau and its upper skirt. Measured on the mesa's own rise: the rolling basin floor
    // sits above 0, so an absolute height would paint dune crests as high ground.
    const mesaRise = W.mesaHeight(x, z);
    if (mesaRise > 12) return 'gravel';
    if (mesaRise > 7) return 'dryGrass';

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
