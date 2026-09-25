// src/world/biome.ts
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';
import { DAM, SPAWN_RISE } from './mapLayout';
import { plainHeight } from './terrain/basePlain';
import { applyLandforms, isDoleriteAt } from './terrain/landforms';
import { borderAt } from './terrain/border';
import { inDuneField } from './terrain/dunes';
import { panWeight } from './terrain/pan';
import { padAt } from './terrain/pads';
import { riverSampleAt, RIVER_LINE } from './terrain/river';
import { inPoort, quarryPartAt } from './terrain/cuts';
import { nearestTrack, onTrackStep } from './terrain/tracks';
import { nearestRoad, ROAD_HALF, ROAD_SHOULDER } from './worldDef';

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
  // Last, so the index of every older cover stays the same.
  salt: 0xeeeae2,
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
/** Share of the pan blend from which the ground reads as salt crust. */
const SALT_FROM = 0.5;
/** The river's sand fan spreads this far onto the pan from the end of the bed. */
const DELTA_FAN = { radius: 140, wander: 40 };
/** The cut surface counts as the river's bank up to this far above it (the rounded bank top). */
const BANK_TOLERANCE = 0.25;
const RIVER_END = RIVER_LINE[RIVER_LINE.length - 1];
const BAR_PATCH_FREQUENCY = 1 / 45;
/** A rock step on a track reads as bare rock this far before and after it. */
const TRACK_STEP_ROCK = 1.5;

export function createBiome(seed: number): Biome {
  // A little fixed-feel variation for the open desert ground (kept seed-deterministic).
  const vary = createNoise2D(mulberry32((seed ^ 0x85ebca6b) >>> 0));
  const waterLevel = plainHeight(DAM.water.x, DAM.water.z) - DAM.waterBelowPlain;

  const coverAt = (x: number, z: number, height: number, slope: number): Cover => {
    // The border ranges: rock from the foot of the face outward, a gravel apron before it.
    const border = borderAt(x, z);
    if (border.faceDepth > 0) return 'rock';
    if (border.inApron) return slope > STEEP_ROCK ? 'rock' : 'gravel';

    // A pad is one gravel flat, roads across it included. Elsewhere a road is a gravel running
    // surface with dirt shoulders, and a drift keeps its gravel down into the river bed.
    if (padAt(x, z)) return 'gravel';
    const road = nearestRoad(x, z, ROAD_HALF + ROAD_SHOULDER);
    if (road) return road.dist <= ROAD_HALF ? 'gravel' : 'dirt';

    // A track's running surface has the track's own cover, bare rock on its rock steps and in the
    // poort. Beside it, the cut and fill faces take the cover of the ground they are part of.
    const canyon = inPoort(x, z, height);
    const track = nearestTrack(x, z, 0);
    if (track) return canyon || onTrackStep(track, TRACK_STEP_ROCK) ? 'rock' : track.line.grading.cover;
    if (canyon) return 'rock';
    const quarry = quarryPartAt(x, z);
    if (quarry) return quarry === 'wall' && slope > STEEP_ROCK ? 'rock' : 'gravel';

    // The salt first: where the river opens onto the pan, its sand spreads out as a fan.
    const pan = panWeight(x, z);
    if (pan > SALT_FROM) {
      const fan = DELTA_FAN.radius + DELTA_FAN.wander * vary(x * 0.01, z * 0.01);
      return Math.hypot(x - RIVER_END.x, z - RIVER_END.z) < fan ? 'sand' : 'salt';
    }

    const river = riverSampleAt(x, z);
    if (river && height <= river.surface + BANK_TOLERANCE) {
      if (river.zone === 'bed') {
        if (river.inDrift) return 'gravel';
        return vary(x * BAR_PATCH_FREQUENCY, z * BAR_PATCH_FREQUENCY) > 0.55 ? 'gravel' : 'sand';
      }
      return river.zone === 'insideBank' ? 'gravel' : 'dirt';
    }
    if (inDuneField(x, z)) return 'sand';

    const landform = applyLandforms(0, x, z);
    if (landform.kind === 'spawnRise' && Math.hypot(x - SPAWN_RISE.x, z - SPAWN_RISE.z) < SPAWN_RISE.top + SPAWN_TOP_GRAVEL) {
      return 'gravel';
    }
    if (landform.kind === 'ridge' && landform.share > 0.1) return 'rock';
    if (landform.kind === 'tafelkop' && landform.share > 0.97) return vary(x * 0.02, z * 0.02) > 0 ? 'gravel' : 'dryGrass';
    if (slope > STEEP_ROCK) return 'rock';
    if (landform.kind === 'koppie' && landform.share > 0.15) return slope > STEEP_GRAVEL ? 'rock' : 'gravel';
    if (landform.kind === 'spur') return slope > STEEP_GRAVEL ? 'rock' : 'gravel';
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

// ── surface tints (plan v3 S2-3, drawn by the client in S2-5) ─────────────────────────
/**
 * How the drawn ground is shaded on top of its cover's texture. The ids only name the look; the
 * client owns the numbers (colour multiplier, desaturation, normal strength) for each.
 */
export const SURFACE_TINT_IDS = ['plain', 'salt', 'gravel', 'dolerite', 'mud'] as const;
export type SurfaceTintId = (typeof SURFACE_TINT_IDS)[number];

const INDEX_BY_TINT = new Map<SurfaceTintId, number>(SURFACE_TINT_IDS.map((tint, index) => [tint, index]));

export function surfaceTintIndex(tint: SurfaceTintId): number {
  const index = INDEX_BY_TINT.get(tint);
  if (index === undefined) throw new Error(`biome: tint "${tint}" has no index`);
  return index;
}

export function surfaceTintFromIndex(index: number): SurfaceTintId {
  const tint = SURFACE_TINT_IDS[index];
  if (tint === undefined) throw new Error(`biome: no tint has index ${index}`);
  return tint;
}

/** The tint of the ground at (x, z) with the cover `coverAt` gave there. */
export function surfaceTintAt(x: number, z: number, cover: Cover): SurfaceTintId {
  switch (cover) {
    case 'salt': return 'salt';
    case 'gravel': return 'gravel';
    case 'mud': return 'mud';
    // The dolerite ridge (and the poort cut into it) is darker than the granite koppies and the ranges.
    case 'rock': return isDoleriteAt(x, z) ? 'dolerite' : 'plain';
    default: return 'plain';
  }
}
