// src/world/terrain/landforms.ts
// Layer 2 of the height: the hills on the plain. Koppies and the dolerite ridge are added to the
// ground; the Tafelkop and the spawn rise are level pads blended in, so their tops stay flat whatever
// the plain does under them.
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../rng';
import { lerp, smoothstep } from '../blend';
import { createFeatureIndex, type Bounds } from '../featureIndex';
import { nearestOnPolyline, smoothPolyline } from '../polyline';
import { CHUNK_SIZE } from '../chunk';
import {
  DOLERITE_RIDGE, KOPPIE_DOME_EXPONENT, KOPPIES, SPAWN_RISE, TAFELKOP, type Koppie,
} from '../mapLayout';
import { plainHeight } from './basePlain';

export type LandformKind = 'koppie' | 'tafelkop' | 'ridge' | 'spawnRise';

type Landform =
  | { kind: 'koppie'; koppie: Koppie }
  | { kind: 'tafelkop' }
  | { kind: 'ridge'; segmentIndex: number }
  | { kind: 'spawnRise' };

const RIDGE_LINE = smoothPolyline(DOLERITE_RIDGE.line, 8);
/** Metres from the ridge line where its flanks start to fall. */
const RIDGE_SHOULDER = 35;
const RIDGE_WAVELENGTH = 300;
const TAFELKOP_EDGE_LOBES = 1.3;

const ridgeNoise = createNoise2D(mulberry32(0xd01e71));
const tafelkopNoise = createNoise2D(mulberry32(0x7afe1c));

/** The flat top of the Tafelkop. */
export const TAFELKOP_LEVEL = plainHeight(TAFELKOP.x, TAFELKOP.z) + TAFELKOP.height;
/** The flat top of the spawn rise, a fixed level above the plain at its centre. */
export const SPAWN_TOP_LEVEL = plainHeight(SPAWN_RISE.x, SPAWN_RISE.z) + SPAWN_RISE.rise;

const square = (x: number, z: number, radius: number): Bounds => ({ minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius });

function boundsOf(landform: Landform): Bounds {
  switch (landform.kind) {
    case 'koppie': return square(landform.koppie.x, landform.koppie.z, landform.koppie.radius);
    case 'tafelkop': return square(TAFELKOP.x, TAFELKOP.z, TAFELKOP.topRadius + TAFELKOP.skirt + TAFELKOP.edgeWander);
    case 'spawnRise': return square(SPAWN_RISE.x, SPAWN_RISE.z, SPAWN_RISE.top + SPAWN_RISE.skirt);
    case 'ridge': {
      const a = RIDGE_LINE[landform.segmentIndex];
      const b = RIDGE_LINE[landform.segmentIndex + 1];
      const reach = DOLERITE_RIDGE.halfWidth;
      return { minX: Math.min(a.x, b.x) - reach, minZ: Math.min(a.z, b.z) - reach, maxX: Math.max(a.x, b.x) + reach, maxZ: Math.max(a.z, b.z) + reach };
    }
  }
}

const LANDFORMS: readonly Landform[] = [
  ...KOPPIES.map((koppie): Landform => ({ kind: 'koppie', koppie })),
  { kind: 'tafelkop' },
  { kind: 'spawnRise' },
  ...RIDGE_LINE.slice(0, -1).map((_point, segmentIndex): Landform => ({ kind: 'ridge', segmentIndex })),
];

const INDEX = createFeatureIndex(LANDFORMS, boundsOf, CHUNK_SIZE);

function koppieRise(koppie: Koppie, x: number, z: number): number {
  const share = Math.hypot(x - koppie.x, z - koppie.z) / koppie.radius;
  if (share >= 1) return 0;
  return koppie.height * (1 - share * share) ** KOPPIE_DOME_EXPONENT;
}

/** 1 on the Tafelkop top, 0 past its skirt; the rim wanders in and out around the hill. */
function tafelkopWeight(x: number, z: number): number {
  const dx = x - TAFELKOP.x;
  const dz = z - TAFELKOP.z;
  const distance = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const rim = TAFELKOP.topRadius + TAFELKOP.edgeWander * tafelkopNoise(Math.cos(angle) * TAFELKOP_EDGE_LOBES, Math.sin(angle) * TAFELKOP_EDGE_LOBES);
  return 1 - smoothstep(rim, rim + TAFELKOP.skirt, distance);
}

function spawnRiseWeight(x: number, z: number): number {
  return 1 - smoothstep(SPAWN_RISE.top, SPAWN_RISE.top + SPAWN_RISE.skirt, Math.hypot(x - SPAWN_RISE.x, z - SPAWN_RISE.z));
}

function ridgeRise(segmentIndices: readonly number[], x: number, z: number): number {
  const hit = nearestOnPolyline(RIDGE_LINE, segmentIndices, x, z);
  if (!hit || hit.distance >= DOLERITE_RIDGE.halfWidth) return 0;
  const crest = DOLERITE_RIDGE.minHeight
    + (DOLERITE_RIDGE.maxHeight - DOLERITE_RIDGE.minHeight) * (0.5 + 0.5 * ridgeNoise(hit.x / RIDGE_WAVELENGTH, hit.z / RIDGE_WAVELENGTH));
  return crest * (1 - smoothstep(RIDGE_SHOULDER, DOLERITE_RIDGE.halfWidth, hit.distance));
}

export interface LandformSample {
  /** Ground height with the landforms applied. */
  height: number;
  /** The landform that raised this point the most, or null on the open plain. */
  kind: LandformKind | null;
  /** How far up that landform the point is: 0 at its foot, 1 at its top. */
  share: number;
}

/** Applies the landforms near (x, z) to the natural ground height there. */
export function applyLandforms(natural: number, x: number, z: number): LandformSample {
  const nearby = INDEX.query(x, z);
  if (nearby.length === 0) return { height: natural, kind: null, share: 0 };
  let height = natural;
  let kind: LandformKind | null = null;
  let share = 0;
  const note = (candidate: LandformKind, candidateShare: number): void => {
    if (candidateShare > share) {
      share = candidateShare;
      kind = candidate;
    }
  };
  const ridgeSegments: number[] = [];
  for (const landform of nearby) {
    if (landform.kind === 'koppie') {
      const rise = koppieRise(landform.koppie, x, z);
      height += rise;
      note('koppie', rise / landform.koppie.height);
    } else if (landform.kind === 'ridge') {
      ridgeSegments.push(landform.segmentIndex);
    }
  }
  if (ridgeSegments.length > 0) {
    const rise = ridgeRise(ridgeSegments, x, z);
    height += rise;
    note('ridge', rise / DOLERITE_RIDGE.maxHeight);
  }
  // Level pads last, so their tops are flat.
  for (const landform of nearby) {
    if (landform.kind === 'tafelkop') {
      const weight = tafelkopWeight(x, z);
      height = lerp(height, TAFELKOP_LEVEL, weight);
      note('tafelkop', weight);
    } else if (landform.kind === 'spawnRise') {
      const weight = spawnRiseWeight(x, z);
      height = lerp(height, SPAWN_TOP_LEVEL, weight);
      note('spawnRise', weight);
    }
  }
  return { height, kind, share };
}
