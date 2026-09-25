// src/world/terrain/border.ts
// The Randberge: per side a gravel apron, a steep face with a sharp toe, then a crest that keeps
// rising a little to the map edge. Along one inward ray the range never goes down (no shelf to land
// on), and the crest height wanders along the side, with narrow notches, so it is never one wall.
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { mulberry32 } from '../rng';
import { clamp } from '../blend';
import { BORDER, MAP_SIZE, NW_GORGE, VIEWPOINTS, type CrestBand, type MapSide } from '../mapLayout';
import type { Point2 } from '../polyline';
import { plainHeight } from './basePlain';
import { SPAWN_TOP_LEVEL, TAFELKOP_LEVEL } from './landforms';

// At real gravity a car carries its speed far up a slope its tyres could never climb (measured: 40 m
// up a 1.2 face from 80 km/h). So the face starts with a steep toe that stops the car, and the face
// above stays well past the best rock grip (0.9), so a car that gets onto it slides back.
const FACE_TOE = { height: 3, slope: 3 };
const FACE_SLOPE = { min: 1.3, max: 1.6 };
/** Metres over which the face rounds over into the crest. */
const FACE_ROUNDING = 16;
/** The crest keeps rising this much per metre toward the map edge (and past it). */
const CREST_SLOPE = 0.05;
const APRON_RISE = { perMetre: 0.12, min: 3, max: 10 };
const NOTCH = { depth: 8, wavelength: 80, sharpness: 5 };
const CREST_WAVELENGTH = 300;
/** The band is used this far inside its ends, so the plain's own tilt never pushes a crest out of it. */
const BAND_INSET = 1;
/** Highest a crest may stand, seen from a viewpoint, so the HDRI mountains show above it (AC5). */
const MAX_VIEW_ANGLE = (2.4 * Math.PI) / 180;
const EYE_HEIGHT = 1.5;
// Ground under each viewpoint without the pads of later steps, so the rule only gets looser later.
const VIEW_EYES: readonly { x: number; z: number; eye: number }[] = [
  { ...VIEWPOINTS.spawn, eye: SPAWN_TOP_LEVEL + EYE_HEIGHT },
  { ...VIEWPOINTS.dorp, eye: plainHeight(VIEWPOINTS.dorp.x, VIEWPOINTS.dorp.z) + EYE_HEIGHT },
  { ...VIEWPOINTS.overlook, eye: TAFELKOP_LEVEL + EYE_HEIGHT },
];
const SLOPE_WAVELENGTH = 260;
const APRON_WAVELENGTH = 300;
/** The west range bulges into the valley around the NW gorge, so the gorge cuts through rock. */
const GORGE_BULGE = { depth: 150, halfLength: 180 };

interface SideFrame {
  side: MapSide;
  band: CrestBand;
  /** Metres inside the map edge on this side. */
  distance(x: number, z: number): number;
  /** Position along this side. */
  along(x: number, z: number): number;
  pointAt(along: number, distance: number): Point2;
  crestNoise: NoiseFunction2D;
  detailNoise: NoiseFunction2D;
}

function frame(side: MapSide, seed: number, geometry: Pick<SideFrame, 'distance' | 'along' | 'pointAt'>): SideFrame {
  return {
    side,
    band: BORDER.crest[side],
    ...geometry,
    crestNoise: createNoise2D(mulberry32(seed)),
    detailNoise: createNoise2D(mulberry32(seed ^ 0x51de)),
  };
}

const SIDES: readonly SideFrame[] = [
  frame('north', 0xb0de01, { distance: (_x, z) => z, along: (x) => x, pointAt: (along, distance) => ({ x: along, z: distance }) }),
  frame('south', 0xb0de02, { distance: (_x, z) => MAP_SIZE - z, along: (x) => x, pointAt: (along, distance) => ({ x: along, z: MAP_SIZE - distance }) }),
  frame('west', 0xb0de03, { distance: (x) => x, along: (_x, z) => z, pointAt: (along, distance) => ({ x: distance, z: along }) }),
  frame('east', 0xb0de04, { distance: (x) => MAP_SIZE - x, along: (_x, z) => z, pointAt: (along, distance) => ({ x: MAP_SIZE - distance, z: along }) }),
];

/** A noise value pushed toward its extremes, in [0, 1], so a band is used from end to end. */
const spread = (value: number): number => 0.5 + 0.5 * clamp(value * 4, -1, 1);

function bulgeAt(side: MapSide, along: number): number {
  if (side !== 'west') return 0;
  const gorgeCentre = (NW_GORGE.area.minZ + NW_GORGE.area.maxZ) / 2;
  const share = (along - gorgeCentre) / GORGE_BULGE.halfLength;
  if (Math.abs(share) >= 1) return 0;
  const bump = 1 - share * share;
  return GORGE_BULGE.depth * bump * bump;
}

interface SideShape {
  apronStart: number;
  faceFoot: number;
  /** Plain height at the start of the apron: the range stands on it along the whole inward ray. */
  basis: number;
  apronRise: number;
  faceSlope: number;
  /** Metres of straight face before it rounds over. */
  straight: number;
  faceTop: number;
}

// A side's shape depends only on the position along it, and a chunk's grid shares one position per
// row or column, so recent shapes are kept. The results never depend on what is in the cache.
const SHAPE_CACHE_LIMIT = 4096;
const shapeCaches = new Map<MapSide, Map<number, SideShape>>();

function sideShape(frame: SideFrame, along: number): SideShape {
  let cache = shapeCaches.get(frame.side);
  if (!cache) {
    cache = new Map();
    shapeCaches.set(frame.side, cache);
  }
  const cached = cache.get(along);
  if (cached) return cached;
  if (cache.size >= SHAPE_CACHE_LIMIT) cache.clear();
  const shape = computeSideShape(frame, along);
  cache.set(along, shape);
  return shape;
}

function computeSideShape(frame: SideFrame, along: number): SideShape {
  const bulge = bulgeAt(frame.side, along);
  const apronStart = BORDER.apronStart + bulge + BORDER.apronWander * frame.detailNoise(along / APRON_WAVELENGTH, 3.7);
  const faceFoot = BORDER.faceFoot + bulge;
  const apronRise = clamp(APRON_RISE.perMetre * (apronStart - faceFoot), APRON_RISE.min, APRON_RISE.max);
  const faceSlope = FACE_SLOPE.min + (FACE_SLOPE.max - FACE_SLOPE.min) * spread(frame.detailNoise(along / SLOPE_WAVELENGTH, -8.2));

  const low = frame.band.min + BAND_INSET;
  const high = frame.band.max - BAND_INSET;
  const apronPoint = frame.pointAt(along, apronStart);
  const basis = plainHeight(apronPoint.x, apronPoint.z);
  const wandering = Math.min(low + (high - low) * spread(frame.crestNoise(along / CREST_WAVELENGTH, 0.5)), viewCap(frame, along, basis));
  const ridged = 1 - Math.abs(frame.crestNoise(along / NOTCH.wavelength, 11.3));
  const notch = Math.min(NOTCH.depth * ridged ** NOTCH.sharpness, Math.max(0, wandering - low));
  const edgeRise = wandering - notch;

  // Chosen so the height at the map edge is exactly `edgeRise` above the plain.
  const toeLength = FACE_TOE.height / FACE_TOE.slope;
  const faceRise = edgeRise - apronRise - FACE_TOE.height;
  const fixedPart = (FACE_ROUNDING * (faceSlope + CREST_SLOPE)) / 2 + CREST_SLOPE * (faceFoot - toeLength - FACE_ROUNDING);
  const straight = Math.max(0, (faceRise - fixedPart) / (faceSlope - CREST_SLOPE));
  return { apronStart, faceFoot, basis, apronRise, faceSlope, straight, faceTop: faceFoot - toeLength - straight - FACE_ROUNDING };
}

/**
 * The highest edge rise (above `basis`) that keeps this part of the crest under MAX_VIEW_ANGLE from
 * every viewpoint. The design's north band is taller than this where it faces the dorp.
 */
function viewCap(frame: SideFrame, along: number, basis: number): number {
  // Measured to the design's face top, nearer than the edge, so the whole crest stays under the angle.
  const crest = frame.pointAt(along, BORDER.faceTop);
  let cap = Infinity;
  for (const view of VIEW_EYES) {
    const distance = Math.hypot(crest.x - view.x, crest.z - view.z);
    cap = Math.min(cap, view.eye + Math.tan(MAX_VIEW_ANGLE) * distance - basis);
  }
  return cap;
}

/** Rise of the range above its basis, `distance` metres inside the edge. Never decreases outward. */
function riseAt(shape: SideShape, distance: number): number {
  if (distance >= shape.apronStart) return 0;
  const past = shape.faceFoot - distance;
  if (past <= 0) {
    const share = (shape.apronStart - distance) / (shape.apronStart - shape.faceFoot);
    return shape.apronRise * (0.5 * share + 0.5 * share * share);
  }
  const toeLength = FACE_TOE.height / FACE_TOE.slope;
  if (past <= toeLength) return shape.apronRise + FACE_TOE.slope * past;
  const onFace = past - toeLength;
  const base = shape.apronRise + FACE_TOE.height;
  const { faceSlope, straight } = shape;
  if (onFace <= straight) return base + faceSlope * onFace;
  const intoRounding = onFace - straight;
  if (intoRounding <= FACE_ROUNDING) {
    return base + faceSlope * onFace - ((faceSlope - CREST_SLOPE) * intoRounding * intoRounding) / (2 * FACE_ROUNDING);
  }
  return base + faceSlope * straight + ((faceSlope + CREST_SLOPE) * FACE_ROUNDING) / 2
    + CREST_SLOPE * (intoRounding - FACE_ROUNDING);
}

// No side reaches further into the valley than this (the gorge bulge plus the widest apron).
const REACH = BORDER.apronStart + BORDER.apronWander + GORGE_BULGE.depth;

export interface BorderSample {
  /** Highest range surface here, or null when no side reaches the point. */
  surface: number | null;
  /** Plain height the nearest range side stands on, constant along one inward ray. */
  basis: number;
  /** Metres past the inner foot of the face of the nearest range side; negative on the valley side. */
  faceDepth: number;
  /** Between the start of the apron and the foot of the face. */
  inApron: boolean;
}

const VALLEY: BorderSample = { surface: null, basis: 0, faceDepth: -Infinity, inApron: false };

export function borderAt(x: number, z: number): BorderSample {
  let surface: number | null = null;
  let basis = 0;
  let faceDepth = -Infinity;
  let inApron = false;
  for (const side of SIDES) {
    const distance = side.distance(x, z);
    if (distance >= REACH) continue;
    const along = side.along(x, z);
    const shape = sideShape(side, along);
    if (distance >= shape.apronStart) continue;
    const sideBasis = shape.basis;
    const sideSurface = sideBasis + riseAt(shape, distance);
    if (surface === null || sideSurface > surface) surface = sideSurface;
    const depth = shape.faceFoot - distance;
    if (depth > faceDepth) {
      faceDepth = depth;
      basis = sideBasis;
      inApron = depth <= 0;
    }
  }
  return surface === null ? VALLEY : { surface, basis, faceDepth, inApron };
}

/** Metres past the inner foot of the border face (the design's safety rule); negative in the valley. */
export function borderFaceDepth(x: number, z: number): number {
  let depth = -Infinity;
  for (const side of SIDES) {
    const faceFoot = BORDER.faceFoot + bulgeAt(side.side, side.along(x, z));
    depth = Math.max(depth, faceFoot - side.distance(x, z));
  }
  return depth;
}

export interface CrestSample {
  /** The point on the top of the face straight out from the sample, on the range side it is deepest in. */
  x: number;
  z: number;
  /** Height of the range at that point, before the gorge is cut into it. */
  height: number;
}

/** The crest of the range side (x, z) is deepest in, or null in the valley where no side reaches. */
export function crestFor(x: number, z: number): CrestSample | null {
  let best: { depth: number; crest: CrestSample } | null = null;
  for (const side of SIDES) {
    const distance = side.distance(x, z);
    if (distance >= REACH) continue;
    const along = side.along(x, z);
    const shape = sideShape(side, along);
    const depth = shape.faceFoot - distance;
    if (best && depth <= best.depth) continue;
    const point = side.pointAt(along, shape.faceTop);
    const height = shape.basis + riseAt(shape, shape.faceTop);
    best = { depth, crest: { x: point.x, z: point.z, height } };
  }
  return best ? best.crest : null;
}

// The NW gorge: a canyon cut into the west range, climbing gently from its mouth on the plain to a
// dry waterfall step, then a short hanging valley that ends in the rock. A natural dead end.
const GORGE = {
  halfWidth: 14,
  wallSlope: 1.6,
  floorRise: 3,
  stepLength: 2,
  hangingSlope: 0.3,
  hangingLength: 40,
  /** How far past the mouth, onto the plain, the canyon floor stays level. */
  apron: 30,
};
const GORGE_DIRECTION = (() => {
  const dx = NW_GORGE.waterfall.x - NW_GORGE.mouth.x;
  const dz = NW_GORGE.waterfall.z - NW_GORGE.mouth.z;
  const length = Math.hypot(dx, dz);
  return { x: dx / length, z: dz / length, length };
})();
const GORGE_MOUTH_LEVEL = plainHeight(NW_GORGE.mouth.x, NW_GORGE.mouth.z);
const GORGE_REACH = GORGE_DIRECTION.length + GORGE.hangingLength + 200;

function gorgeFloor(along: number): number {
  const length = GORGE_DIRECTION.length;
  if (along <= 0) return GORGE_MOUTH_LEVEL;
  if (along <= length) return GORGE_MOUTH_LEVEL + (GORGE.floorRise * along) / length;
  const lip = GORGE_MOUTH_LEVEL + GORGE.floorRise;
  if (along <= length + GORGE.stepLength) return lip + (NW_GORGE.waterfallStep * (along - length)) / GORGE.stepLength;
  return lip + NW_GORGE.waterfallStep + GORGE.hangingSlope * (along - length - GORGE.stepLength);
}

/** Cuts the NW gorge into a ground height; unchanged away from the gorge. */
export function carveGorge(height: number, x: number, z: number): number {
  const dx = x - NW_GORGE.mouth.x;
  const dz = z - NW_GORGE.mouth.z;
  if (Math.abs(dx) > GORGE_REACH || Math.abs(dz) > GORGE_REACH) return height;
  const along = dx * GORGE_DIRECTION.x + dz * GORGE_DIRECTION.z;
  const across = Math.abs(dx * GORGE_DIRECTION.z - dz * GORGE_DIRECTION.x);
  const end = GORGE_DIRECTION.length + GORGE.stepLength + GORGE.hangingLength;
  const pastSide = Math.max(0, across - GORGE.halfWidth);
  const pastEnd = Math.max(0, along - end, -GORGE.apron - along);
  const wall = GORGE.wallSlope * Math.hypot(pastSide, pastEnd);
  return Math.min(height, gorgeFloor(Math.min(along, end)) + wall);
}

/** Metres inside the nearest map edge; negative outside the map. */
export function borderDistance(x: number, z: number): number {
  return Math.min(x, z, MAP_SIZE - x, MAP_SIZE - z);
}
