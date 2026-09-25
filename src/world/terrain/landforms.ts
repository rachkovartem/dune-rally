// src/world/terrain/landforms.ts
// Layer 2 of the height: the hills on the plain. Koppies, the Klim spur and the dolerite ridge are
// added to the ground; the Tafelkop and the spawn rise are level pads blended in, so their tops stay
// flat whatever the plain does under them.
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { mulberry32 } from '../rng';
import { clamp, lerp, smoothstep } from '../blend';
import { createFeatureIndex, type Bounds } from '../featureIndex';
import { nearestOnPolyline, smoothPolyline, type Point2 } from '../polyline';
import { CHUNK_SIZE } from '../chunk';
import {
  DOLERITE_RIDGE, KLIM_SPUR, KOPPIE_LUMPS, KOPPIE_PROFILE, KOPPIES, SPAWN_RISE, TAFELKOP, type Koppie,
} from '../mapLayout';
import { microRelief, plainHeight } from './basePlain';

export type LandformKind = 'koppie' | 'spur' | 'tafelkop' | 'ridge' | 'spawnRise';

interface KoppieForm {
  kind: 'koppie';
  koppie: Koppie;
  /** Makes the outline irregular, and moves the band and the tor in and out around the koppie. */
  outlineNoise: NoiseFunction2D;
  wanderNoise: NoiseFunction2D;
}

type Landform =
  | KoppieForm
  | { kind: 'spur' }
  | { kind: 'tafelkop' }
  | { kind: 'ridge'; segmentIndex: number }
  | { kind: 'spawnRise' };

const RIDGE_LINE = smoothPolyline(DOLERITE_RIDGE.line, 8);
/** Metres from the ridge line where its flanks start to fall. */
const RIDGE_SHOULDER = 35;
const RIDGE_WAVELENGTH = 300;
const TAFELKOP_EDGE_LOBES = 1.3;
const KOPPIE_WANDER_LOBES = 1.6;
const KOPPIE_OUTLINE_LOBES = 1.2;
/** Reads the band's height from another part of the wander noise, so it does not follow the wander. */
const BAND_SWING_OFFSET = 7.3;

const ridgeNoise = createNoise2D(mulberry32(0xd01e71));
const tafelkopNoise = createNoise2D(mulberry32(0x7afe1c));
const lumpNoise = createNoise2D(mulberry32(0x1a3b5c));

/** The flat top of the Tafelkop. */
export const TAFELKOP_LEVEL = plainHeight(TAFELKOP.x, TAFELKOP.z) + TAFELKOP.height;
/** The flat top of the spawn rise, a fixed level above the plain at its centre. */
export const SPAWN_TOP_LEVEL = plainHeight(SPAWN_RISE.x, SPAWN_RISE.z) + SPAWN_RISE.rise;

const square = (x: number, z: number, radius: number): Bounds => ({ minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius });

const KOPPIE_FORMS: readonly KoppieForm[] = KOPPIES.map((koppie, index) => ({
  kind: 'koppie',
  koppie,
  outlineNoise: createNoise2D(mulberry32(0x6b0a0e1 + index)),
  wanderNoise: createNoise2D(mulberry32(0x6b0991e + index)),
}));

/** The farthest a koppie's foot reaches from its centre: the outline only ever moves inward. */
const koppieReach = (koppie: Koppie): number => koppie.radius;

// ── koppies ──────────────────────────────────────────────────────────────────────────
/** Where a koppie's band sits and how tall it is, in one direction around the koppie. */
interface BandShape {
  /** How far the band and the tor are moved out (share of the radius). */
  wander: number;
  /** The band's share of the koppie's height. */
  drop: number;
}

/** Height share (1 at the top, 0 at the foot) at `share` of the radius, for the band `band`. */
function koppieProfile(share: number, band: BandShape, koppie: Koppie): number {
  const { top, tor, shoulder } = KOPPIE_PROFILE;
  const bandWidth = bandWidthShare(band, koppie);
  const shoulderDrop = shoulder.drop + KOPPIE_PROFILE.band.drop - band.drop;
  const torTop = tor.centre + band.wander - tor.width / 2;
  const torFoot = tor.centre + band.wander + tor.width / 2;
  const bandTop = KOPPIE_PROFILE.band.centre + band.wander - bandWidth / 2;
  const bandFoot = KOPPIE_PROFILE.band.centre + band.wander + bandWidth / 2;
  const apronDrop = 1 - top.drop - tor.drop - shoulder.drop - KOPPIE_PROFILE.band.drop;
  const insideTop = Math.min(share, top.radius) / top.radius;
  // The band rises abruptly from the apron and rounds over at its top, like the border face: a car
  // carried in by its speed meets the steep part first and cannot run up the band on momentum.
  const belowBandTop = Math.min(1, Math.max(0, (share - bandTop) / (bandFoot - bandTop)));
  const drops = top.drop * (1 - (1 - insideTop * insideTop) ** 2)
    + tor.drop * smoothstep(torTop, torFoot, share)
    + shoulderDrop * smoothstep(torFoot, bandTop, share)
    + band.drop * belowBandTop * belowBandTop
    + apronDrop * smoothstep(bandFoot, 1, share);
  return 1 - drops;
}

function koppieShape(form: KoppieForm, x: number, z: number): { share: number; band: BandShape; radius: number } {
  const { koppie } = form;
  const distance = Math.hypot(x - koppie.x, z - koppie.z);
  // The direction on the unit circle, without trigonometry; the centre itself takes any direction.
  const cosine = distance > 0 ? (x - koppie.x) / distance : 1;
  const sine = distance > 0 ? (z - koppie.z) / distance : 0;
  const inward = 0.5 + 0.5 * form.outlineNoise(cosine * KOPPIE_OUTLINE_LOBES, sine * KOPPIE_OUTLINE_LOBES);
  const radius = koppie.radius * (1 - KOPPIE_PROFILE.outline * inward);
  const share = distance / radius;
  if (share >= 1) return { share, band: { wander: 0, drop: KOPPIE_PROFILE.band.drop }, radius };
  return {
    share,
    radius,
    band: {
      wander: KOPPIE_PROFILE.wander * form.wanderNoise(cosine * KOPPIE_WANDER_LOBES, sine * KOPPIE_WANDER_LOBES),
      drop: KOPPIE_PROFILE.band.drop + KOPPIE_PROFILE.bandSwing * form.wanderNoise(sine * KOPPIE_WANDER_LOBES + BAND_SWING_OFFSET, cosine * KOPPIE_WANDER_LOBES),
    },
  };
}

/** Share of a koppie's radius the band takes, from its drop: the band's toe slope fixes its width. */
function bandWidthShare(band: BandShape, koppie: Koppie): number {
  return (2 * band.drop * koppie.height) / (KOPPIE_PROFILE.band.toeSlope * koppie.radius);
}

function koppieRise(form: KoppieForm, x: number, z: number): number {
  const { share, band } = koppieShape(form, x, z);
  if (share >= 1) return 0;
  return form.koppie.height * koppieProfile(share, band, form.koppie);
}

// ── the Klim spur ────────────────────────────────────────────────────────────────────
const SPUR_LINE: readonly Point2[] = [KLIM_SPUR.from, KLIM_SPUR.to];
/** The spur's sides reach down at most this far below its crest. */
const SPUR_MAX_DROP = 40;
const SPUR_REACH = KLIM_SPUR.topHalfWidth + 1 + SPUR_MAX_DROP / KLIM_SPUR.sideSlope;
/** Where the spur raises the ground by more than this, the ground counts as the spur. */
const SPUR_NOTICED = 0.25;

/** Ground at a spur end without the spur: the plain and the koppies there. */
function groundWithoutSpur(point: Point2): number {
  let height = plainHeight(point.x, point.z) + microRelief(point.x, point.z);
  for (const form of KOPPIE_FORMS) height += koppieRise(form, point.x, point.z);
  return height;
}

const SPUR_CREST = { from: groundWithoutSpur(KLIM_SPUR.from), to: groundWithoutSpur(KLIM_SPUR.to) };

/** Surface of the spur: a crest climbing from end to end, steep rock sides rounded at the top. */
function spurSurface(x: number, z: number): number {
  const hit = nearestOnPolyline(SPUR_LINE, [0], x, z);
  if (!hit) throw new Error('landforms: the Klim spur has no segment');
  const past = hit.distance - KLIM_SPUR.topHalfWidth;
  const fall = past <= -1 ? 0 : past >= 1 ? past : (past + 1) ** 2 / 4;
  return lerp(SPUR_CREST.from, SPUR_CREST.to, hit.t) - KLIM_SPUR.sideSlope * fall;
}

// ── the feature index ────────────────────────────────────────────────────────────────
function boundsOf(landform: Landform): Bounds {
  switch (landform.kind) {
    case 'koppie': return square(landform.koppie.x, landform.koppie.z, koppieReach(landform.koppie));
    case 'spur': return {
      minX: Math.min(KLIM_SPUR.from.x, KLIM_SPUR.to.x) - SPUR_REACH,
      minZ: Math.min(KLIM_SPUR.from.z, KLIM_SPUR.to.z) - SPUR_REACH,
      maxX: Math.max(KLIM_SPUR.from.x, KLIM_SPUR.to.x) + SPUR_REACH,
      maxZ: Math.max(KLIM_SPUR.from.z, KLIM_SPUR.to.z) + SPUR_REACH,
    };
    case 'tafelkop': return square(TAFELKOP.x, TAFELKOP.z, TAFELKOP.topRadius + Math.max(TAFELKOP.skirt, TAFELKOP.talus.skirt) + TAFELKOP.edgeWander);
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
  ...KOPPIE_FORMS,
  { kind: 'spur' },
  { kind: 'tafelkop' },
  { kind: 'spawnRise' },
  ...RIDGE_LINE.slice(0, -1).map((_point, segmentIndex): Landform => ({ kind: 'ridge', segmentIndex })),
];

const INDEX = createFeatureIndex(LANDFORMS, boundsOf, CHUNK_SIZE);
/** Only the landforms that carry boulder lumps, so the plain and the ridge do not pay for them. */
const LUMP_INDEX = createFeatureIndex(LANDFORMS.filter((landform) => landform.kind === 'koppie' || landform.kind === 'spur'), boundsOf, CHUNK_SIZE);

const TALUS_ANGLE = (TAFELKOP.talus.angle * Math.PI) / 180;
const TALUS_HALF_ANGLE = (TAFELKOP.talus.halfAngle * Math.PI) / 180;

/** Width of the Tafelkop's skirt in the direction `angle`: the talus sector is wider. */
function tafelkopSkirt(angle: number): number {
  const apart = Math.abs(Math.atan2(Math.sin(angle - TALUS_ANGLE), Math.cos(angle - TALUS_ANGLE)));
  const talus = apart >= TALUS_HALF_ANGLE ? 0 : Math.cos((Math.PI / 2) * (apart / TALUS_HALF_ANGLE)) ** 2;
  return lerp(TAFELKOP.skirt, TAFELKOP.talus.skirt, talus);
}

/** 1 on the Tafelkop top, 0 past its skirt; the rim wanders in and out around the hill. */
function tafelkopWeight(x: number, z: number): number {
  const dx = x - TAFELKOP.x;
  const dz = z - TAFELKOP.z;
  const distance = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const rim = TAFELKOP.topRadius + TAFELKOP.edgeWander * tafelkopNoise(Math.cos(angle) * TAFELKOP_EDGE_LOBES, Math.sin(angle) * TAFELKOP_EDGE_LOBES);
  return 1 - smoothstep(rim, rim + tafelkopSkirt(angle), distance);
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
  // The landform that raised the point the most names it; no closure here, this runs per sample.
  let height = natural;
  let kind: LandformKind | null = null;
  let share = 0;
  let ridgeSegments: number[] | null = null;
  for (const landform of nearby) {
    if (landform.kind === 'koppie') {
      const rise = koppieRise(landform, x, z);
      height += rise;
      const koppieShare = rise / landform.koppie.height;
      if (koppieShare > share) {
        share = koppieShare;
        kind = 'koppie';
      }
    } else if (landform.kind === 'ridge') {
      if (!ridgeSegments) ridgeSegments = [];
      ridgeSegments.push(landform.segmentIndex);
    }
  }
  if (ridgeSegments) {
    const rise = ridgeRise(ridgeSegments, x, z);
    height += rise;
    const ridgeShare = rise / DOLERITE_RIDGE.maxHeight;
    if (ridgeShare > share) {
      share = ridgeShare;
      kind = 'ridge';
    }
  }
  // The spur fills the ground between the two koppies up to its own surface.
  for (const landform of nearby) {
    if (landform.kind !== 'spur') continue;
    const surface = spurSurface(x, z);
    if (surface <= height) continue;
    if (surface - height > SPUR_NOTICED && share < 1) {
      share = 1;
      kind = 'spur';
    }
    height = surface;
  }
  // Level pads last, so their tops are flat.
  for (const landform of nearby) {
    if (landform.kind === 'tafelkop') {
      const weight = tafelkopWeight(x, z);
      height = lerp(height, TAFELKOP_LEVEL, weight);
      if (weight > share) {
        share = weight;
        kind = 'tafelkop';
      }
    } else if (landform.kind === 'spawnRise') {
      const weight = spawnRiseWeight(x, z);
      height = lerp(height, SPAWN_TOP_LEVEL, weight);
      if (weight > share) {
        share = weight;
        kind = 'spawnRise';
      }
    }
  }
  return { height, kind, share };
}

// ── boulder lumps and rock kinds ─────────────────────────────────────────────────────
/** Share of a koppie's radius where the lumps start (the smooth top has none) and where they are full. */
const LUMP_TOP = { from: 0.1, to: 0.2 };
/** Share of the radius over which the lumps fade out toward the foot. */
const LUMP_FOOT = 0.85;
/** Metres past the spur's crest over which the lumps fade in on its sides. */
const SPUR_LUMP_FADE = 4;
/** The saddle at the spur's upper end is gravel (design §3), so its lumps fade out around it. */
const SADDLE_CLEAR = { from: 12, to: 30 };

function ridged(x: number, z: number): number {
  const value = 1 - Math.abs(lumpNoise(x / KOPPIE_LUMPS.wavelength, z / KOPPIE_LUMPS.wavelength));
  return value * value;
}

/**
 * Ridged boulder lumps (design §12.1) on the koppie flanks and the sides of the Klim spur, metres.
 * They only ever raise the ground, so they never dig a pit. 0 away from the koppies.
 */
export function koppieLumps(x: number, z: number): number {
  const nearby = LUMP_INDEX.query(x, z);
  if (nearby.length === 0) return 0;
  let lumpHeight = 0;
  for (const landform of nearby) {
    if (landform.kind === 'koppie') {
      const { koppie } = landform;
      const { share } = koppieShape(landform, x, z);
      if (share >= 1) continue;
      const weight = smoothstep(LUMP_TOP.from, LUMP_TOP.to, share) * (1 - smoothstep(LUMP_FOOT, 1, share));
      const height = clamp(koppie.height * KOPPIE_LUMPS.heightPerMetre, KOPPIE_LUMPS.minHeight, KOPPIE_LUMPS.maxHeight);
      lumpHeight = Math.max(lumpHeight, height * weight);
    } else if (landform.kind === 'spur') {
      const hit = nearestOnPolyline(SPUR_LINE, [0], x, z);
      if (!hit || hit.distance >= SPUR_REACH) continue;
      const weight = smoothstep(KLIM_SPUR.topHalfWidth, KLIM_SPUR.topHalfWidth + SPUR_LUMP_FADE, hit.distance)
        * (1 - smoothstep(SPUR_REACH - SPUR_LUMP_FADE, SPUR_REACH, hit.distance));
      lumpHeight = Math.max(lumpHeight, KOPPIE_LUMPS.minHeight * weight);
    }
  }
  if (lumpHeight <= 0) return 0;
  const saddle = smoothstep(SADDLE_CLEAR.from, SADDLE_CLEAR.to, Math.hypot(x - KLIM_SPUR.to.x, z - KLIM_SPUR.to.z));
  return lumpHeight * saddle * ridged(x, z);
}

/** Where (x, z) lies across a koppie's rock band, in metres along the ground from the koppie's centre. */
export interface KoppieBandSample {
  /** Metres outward from the band's top edge (the crest): negative on the shoulder above it. */
  fromCrest: number;
  /** Metres from the band's crest to its foot. */
  width: number;
}

/** The band of the koppie that stands at (x, z), or null off every koppie. */
export function koppieBandAt(x: number, z: number): KoppieBandSample | null {
  for (const landform of LUMP_INDEX.query(x, z)) {
    if (landform.kind !== 'koppie') continue;
    const { share, band, radius } = koppieShape(landform, x, z);
    if (share >= 1) continue;
    const width = bandWidthShare(band, landform.koppie);
    const crest = KOPPIE_PROFILE.band.centre + band.wander - width / 2;
    return { fromCrest: (share - crest) * radius, width: width * radius };
  }
  return null;
}

/** Height the dolerite ridge adds at (x, z) before anything is cut into it. */
export function ridgeRiseAt(x: number, z: number): number {
  const segments: number[] = [];
  for (const landform of INDEX.query(x, z)) if (landform.kind === 'ridge') segments.push(landform.segmentIndex);
  return segments.length > 0 ? ridgeRise(segments, x, z) : 0;
}

export type RockKind = 'granite' | 'dolerite';

/**
 * Which rock the ground at (x, z) is made of: dark dolerite where the ridge stands (the poort cut
 * into it included), granite on the koppies and the Klim spur. The two never meet on this map.
 */
export function rockKindAt(x: number, z: number): RockKind | null {
  if (ridgeRiseAt(x, z) > ROCK_SHARE * DOLERITE_RIDGE.maxHeight) return 'dolerite';
  const landform = applyLandforms(0, x, z);
  if ((landform.kind === 'koppie' && landform.share > ROCK_SHARE) || landform.kind === 'spur') return 'granite';
  return null;
}

/** True where the dolerite ridge stands, the ground a darker rock than anywhere else. */
export function isDoleriteAt(x: number, z: number): boolean {
  return ridgeRiseAt(x, z) > ROCK_SHARE * DOLERITE_RIDGE.maxHeight;
}

/** A landform counts as rock from this share of its height up. */
const ROCK_SHARE = 0.1;
