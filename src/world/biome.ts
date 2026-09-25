// src/world/biome.ts
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';
import { DAM, SPAWN_RISE } from './mapLayout';
import { plainHeight } from './terrain/basePlain';
import { applyLandforms } from './terrain/landforms';
import { borderAt } from './terrain/border';

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
  /** Level of the dam water (the only water on the map; its bowl lands in plan v3 step S4). */
  waterLevel: number;
  /** Coverage TYPE at a world point (authored zones + height/slope). */
  coverAt(x: number, z: number, h: number, slope: number): Cover;
  /** Hex coverage colour at a world point. */
  colorAt(x: number, z: number, h: number, slope: number): number;
}

const STEEP_ROCK = 0.55;
const STEEP_GRAVEL = 0.3;
/** Cover patches of the plain are 100–400 m across. */
const PATCH_FREQUENCY = 1 / 260;
const SPAWN_TOP_GRAVEL = 8;

export function createBiome(seed: number): Biome {
  // A little fixed-feel variation for the open desert ground (kept seed-deterministic).
  const vary = createNoise2D(mulberry32((seed ^ 0x85ebca6b) >>> 0));
  const waterLevel = plainHeight(DAM.water.x, DAM.water.z) - DAM.waterBelowPlain;

  const coverAt = (x: number, z: number, _height: number, slope: number): Cover => {
    // The border ranges: rock from the foot of the face outward, a gravel apron before it.
    const border = borderAt(x, z);
    if (border.faceDepth > 0) return 'rock';
    if (border.inApron) return slope > STEEP_ROCK ? 'rock' : 'gravel';

    const landform = applyLandforms(0, x, z);
    if (landform.kind === 'spawnRise' && Math.hypot(x - SPAWN_RISE.x, z - SPAWN_RISE.z) < SPAWN_RISE.top + SPAWN_TOP_GRAVEL) {
      return 'gravel';
    }
    if (landform.kind === 'ridge' && landform.share > 0.1) return 'rock';
    if (landform.kind === 'tafelkop' && landform.share > 0.97) return vary(x * 0.02, z * 0.02) > 0 ? 'gravel' : 'dryGrass';
    if (slope > STEEP_ROCK) return 'rock';
    if (landform.kind === 'koppie' && landform.share > 0.15) return slope > STEEP_GRAVEL ? 'rock' : 'gravel';
    if (slope > STEEP_GRAVEL) return 'gravel';

    // The open plain: sand with patches of dry grass and hard dirt.
    const patch = vary(x * PATCH_FREQUENCY, z * PATCH_FREQUENCY) + 0.35 * vary(x * PATCH_FREQUENCY * 3 + 40, z * PATCH_FREQUENCY * 3 - 17);
    if (patch > 0.45) return 'dryGrass';
    if (patch < -0.55) return 'dirt';
    return 'sand';
  };

  return {
    waterLevel,
    coverAt,
    colorAt: (x, z, h, slope) => COVER[coverAt(x, z, h, slope)],
  };
}
