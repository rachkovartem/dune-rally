// src/world/groundSoftness.ts
// How soft the ground is at a place (0 firm .. 1 deep dune sand): how fast a spinning wheel digs
// in. All sand shares one cover, so the place decides: dunes are soft, the river sand less, the
// open plain is nearly firm. Client and server both read it through groundAt.
import type { Cover } from './biome';
import { inDuneField } from './terrain/dunes';
import { panWeight } from './terrain/pan';
import { riverSampleAt } from './terrain/river';

export const GROUND_SOFTNESS = {
  duneSand: 1,
  /** The river bed sand and its fan on the pan. */
  riverSand: 0.6,
  /** The open plain: sand, but it holds a car that keeps moving. */
  plainSand: 0.15,
  mud: 0.8,
  /** Covers not placed on the map today. */
  beach: 0.5,
  snow: 0.5,
  water: 0.5,
} as const;

// The same share of the pan blend from which biome.coverAt reads the ground as salt; there the
// sand is the river's fan. Keep the two equal (see the S3 hand-over note).
const PAN_FAN_FROM = 0.5;

/** Softness of the ground at (x, z) with the cover `coverAt` gave there. */
export function groundSoftnessAt(x: number, z: number, cover: Cover): number {
  switch (cover) {
    case 'sand': return sandSoftnessAt(x, z);
    case 'mud': return GROUND_SOFTNESS.mud;
    case 'beach': return GROUND_SOFTNESS.beach;
    case 'snow': return GROUND_SOFTNESS.snow;
    case 'water': return GROUND_SOFTNESS.water;
    default: return 0;
  }
}

// In the same order coverAt finds sand: the fan on the pan, the river bed, the dune field, the plain.
function sandSoftnessAt(x: number, z: number): number {
  if (panWeight(x, z) > PAN_FAN_FROM) return GROUND_SOFTNESS.riverSand;
  if (riverSampleAt(x, z)?.zone === 'bed') return GROUND_SOFTNESS.riverSand;
  if (inDuneField(x, z)) return GROUND_SOFTNESS.duneSand;
  return GROUND_SOFTNESS.plainSand;
}
