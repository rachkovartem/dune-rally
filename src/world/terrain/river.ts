// src/world/terrain/river.ts
// The Sandrivier (design §6): a dry sand bed from the NW gorge to the pan that only runs downhill,
// steep on the outside of a bend and a low point bar on the inside. The Plaaslus crosses it at two
// drift ramps, and at the bend near (740, 1470) Die Sprong throws a kicker over the channel.
import { clamp, lerp, smoothstep } from '../blend';
import { createNearestSegmentIndex } from '../featureIndex';
import { nearestOnPolyline, smoothPolyline, type Point2, type SegmentHit } from '../polyline';
import { DIE_SPRONG, SANDRIVIER } from '../mapLayout';
import { baseGroundHeight } from './baseGround';
import { PAN_LEVEL } from './pan';
import { ROAD_LINES } from './roads';

// Bends are gentle (radius ≥ 130 m), so an 8 m chord is within 6 cm of the curve.
const SPACING = 8;

/** The smoothed centre line of the bed, from the gorge to the delta. */
export const RIVER_LINE: readonly Point2[] = smoothPolyline(SANDRIVIER.line, SPACING);

const COUNT = RIVER_LINE.length;
/** Distance along the centre line of each point, metres. */
export const RIVER_ALONG: Float64Array = (() => {
  const along = new Float64Array(COUNT);
  for (let index = 1; index < COUNT; index++) {
    along[index] = along[index - 1] + Math.hypot(RIVER_LINE[index].x - RIVER_LINE[index - 1].x, RIVER_LINE[index].z - RIVER_LINE[index - 1].z);
  }
  return along;
})();
export const RIVER_LENGTH = RIVER_ALONG[COUNT - 1];

function valueAt(values: Float64Array, distance: number): number {
  const position = clamp(distance / (RIVER_LENGTH / (COUNT - 1)), 0, COUNT - 1);
  const low = Math.min(COUNT - 2, Math.floor(position));
  return values[low] + (values[low + 1] - values[low]) * (position - low);
}

// ── bends ────────────────────────────────────────────────────────────────────────────
// Signed curvature (1/m), positive where the line turns toward the side nearestOnPolyline calls +1,
// averaged over this many metres each way so one resampling wiggle is not a bend.
const CURVATURE_WINDOW = 40;
const CURVATURE: Float64Array = (() => {
  const raw = new Float64Array(COUNT);
  for (let index = 1; index < COUNT - 1; index++) {
    const before = RIVER_LINE[index - 1];
    const point = RIVER_LINE[index];
    const after = RIVER_LINE[index + 1];
    const ax = point.x - before.x;
    const az = point.z - before.z;
    const bx = after.x - point.x;
    const bz = after.z - point.z;
    const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    raw[index] = turn / (RIVER_ALONG[index + 1] - RIVER_ALONG[index - 1]) * 2;
  }
  const reach = Math.round(CURVATURE_WINDOW / SPACING);
  const averaged = new Float64Array(COUNT);
  for (let index = 0; index < COUNT; index++) {
    let sum = 0;
    let count = 0;
    for (let other = Math.max(0, index - reach); other <= Math.min(COUNT - 1, index + reach); other++) {
      sum += raw[other];
      count++;
    }
    averaged[index] = sum / count;
  }
  return averaged;
})();

/** Bends of at least this curvature get the full outside/inside bank contrast. */
const SHARP_BEND = { from: 1 / 900, to: 1 / 350 };
const STRAIGHT_BANK_SLOPE = 0.42;

export type BankSide = 'inside' | 'outside';

/** Which bank a point beside the line is on: `side` is the SegmentHit side of the point. */
export function bankSideAt(distance: number, side: -1 | 1): BankSide {
  const curvature = valueAt(CURVATURE, distance);
  return Math.sign(curvature) === side ? 'inside' : 'outside';
}

/** Slope of the bank on `side` at `distance` along the river. */
export function bankSlopeAt(distance: number, side: -1 | 1): number {
  const sharpness = smoothstep(SHARP_BEND.from, SHARP_BEND.to, Math.abs(valueAt(CURVATURE, distance)));
  const outside = (SANDRIVIER.outsideBankSlope.min + SANDRIVIER.outsideBankSlope.max) / 2;
  const inside = (SANDRIVIER.insideBankSlope.min + SANDRIVIER.insideBankSlope.max) / 2;
  return lerp(STRAIGHT_BANK_SLOPE, bankSideAt(distance, side) === 'inside' ? inside : outside, sharpness);
}

/** Signed curvature (1/m) of the centre line at `distance`, for choosing the sharpest bends. */
export function riverCurvatureAt(distance: number): number {
  return valueAt(CURVATURE, distance);
}

// ── the bed ──────────────────────────────────────────────────────────────────────────
/** Half the bed's width at `distance` along the river: 12.5 m in the north, 20 m at the pan. */
export function bedHalfWidthAt(distance: number): number {
  return lerp(SANDRIVIER.bedWidth.north, SANDRIVIER.bedWidth.south, clamp(distance / RIVER_LENGTH, 0, 1)) / 2;
}

/** Depth of the bed below the ground at its centre before the downhill rule. */
function plannedDepthAt(distance: number): number {
  const { depth, headLength, deltaLength } = SANDRIVIER;
  const middle = RIVER_LENGTH / 2;
  const deltaStart = RIVER_LENGTH - deltaLength;
  if (distance <= headLength) return depth.north * smoothstep(0, headLength, distance);
  if (distance <= middle) return lerp(depth.north, depth.middle, (distance - headLength) / (middle - headLength));
  if (distance <= deltaStart) return depth.middle;
  return lerp(depth.middle, depth.delta, clamp((distance - deltaStart) / deltaLength, 0, 1));
}

// The bed never climbs downstream (no pond), and never sinks below the pan it runs into.
const BED: Float64Array = (() => {
  const bed = new Float64Array(COUNT);
  let lowest = Infinity;
  for (let index = 0; index < COUNT; index++) {
    const point = RIVER_LINE[index];
    lowest = Math.min(lowest, baseGroundHeight(point.x, point.z) - plannedDepthAt(RIVER_ALONG[index]));
    bed[index] = Math.max(PAN_LEVEL, lowest);
  }
  return bed;
})();

/** Height of the bed `distance` metres from the gorge. */
export function bedHeightAt(distance: number): number {
  return valueAt(BED, distance);
}

/** Where the bed runs through the gorge (its walls are the banks) and where it opens onto the pan. */
export const RIVER_SPANS = {
  head: { from: 0, to: SANDRIVIER.headLength },
  delta: { from: RIVER_LENGTH - SANDRIVIER.deltaLength, to: RIVER_LENGTH },
} as const;

// ── drifts ───────────────────────────────────────────────────────────────────────────
const PLAASLUS = ROAD_LINES.find((line) => line.name === 'Plaaslus');
if (!PLAASLUS) throw new Error('river: the Plaaslus road is missing, the drifts cross it');
const DRIFT_ROAD: Readonly<{ points: readonly Point2[] }> = PLAASLUS;
/** How far from a drift point along the river the ramp reaches. */
const DRIFT_REACH = { full: 60, fade: 100 };
const DRIFT_SIDE_FADE = 8;

interface Drift {
  at: Point2;
  /** Distance along the river of the crossing. */
  riverDistance: number;
}

const DRIFT_ROAD_INDEX = createNearestSegmentIndex(DRIFT_ROAD.points, SANDRIVIER.drift.width / 2 + DRIFT_SIDE_FADE, 8);

const DRIFTS: readonly Drift[] = SANDRIVIER.drifts.map((at) => {
  const road = nearestOnPolyline(DRIFT_ROAD.points, DRIFT_ROAD_INDEX.query(at.x, at.z), at.x, at.z);
  if (!road || road.distance > 20) throw new Error(`river: the drift at (${at.x}, ${at.z}) is not on the Plaaslus`);
  const river = nearestOnPolyline(RIVER_LINE, RIVER_LINE.slice(0, -1).map((_point, index) => index), at.x, at.z);
  if (!river || river.distance > 30) throw new Error(`river: the drift at (${at.x}, ${at.z}) is not on the river`);
  return { at, riverDistance: distanceAlong(river) };
});

/** 1 on the drift ramp where the road crosses, 0 away from it. */
function driftWeight(x: number, z: number): number {
  let weight = 0;
  for (const drift of DRIFTS) {
    const fromDrift = Math.hypot(x - drift.at.x, z - drift.at.z);
    if (fromDrift >= DRIFT_REACH.fade) continue;
    const road = nearestOnPolyline(DRIFT_ROAD.points, DRIFT_ROAD_INDEX.query(x, z), x, z);
    if (!road) continue;
    const half = SANDRIVIER.drift.width / 2;
    const across = 1 - smoothstep(half, half + DRIFT_SIDE_FADE, road.distance);
    weight = Math.max(weight, across * (1 - smoothstep(DRIFT_REACH.full, DRIFT_REACH.fade, fromDrift)));
  }
  return weight;
}

/** The drift crossings, as distances along the river, for the bank checks. */
export const DRIFT_RIVER_DISTANCES: readonly number[] = DRIFTS.map((drift) => drift.riverDistance);

// ── carving ──────────────────────────────────────────────────────────────────────────
// The deepest the bed gets below the plain beside it, with the downhill rule, stays well under this.
const MAX_BANK_HEIGHT = 10;
const RIVER_REACH = SANDRIVIER.bedWidth.south / 2 + MAX_BANK_HEIGHT / SANDRIVIER.drift.rampSlope;
/** Bank tops are rounded over about this height, so a car rolls over the edge instead of a kink. */
const BANK_ROUNDING = 0.35;
const INDEX_CELL = 8;

const SEGMENT_INDEX = createNearestSegmentIndex(RIVER_LINE, RIVER_REACH, INDEX_CELL);

function distanceAlong(hit: SegmentHit): number {
  return RIVER_ALONG[hit.segmentIndex] + hit.t * (RIVER_ALONG[hit.segmentIndex + 1] - RIVER_ALONG[hit.segmentIndex]);
}

export type RiverZone = 'bed' | 'insideBank' | 'outsideBank';

export interface RiverSample {
  zone: RiverZone;
  /** Height of the cut surface here: where the ground is at or below it, the river shaped it. */
  surface: number;
  /** Metres from the centre line, and along it from the gorge. */
  distance: number;
  along: number;
  inDrift: boolean;
}

/** The river's cut near (x, z), or null where it does not reach. */
export function riverSampleAt(x: number, z: number): RiverSample | null {
  const candidates = SEGMENT_INDEX.query(x, z);
  if (candidates.length === 0) return null;
  const hit = nearestOnPolyline(RIVER_LINE, candidates, x, z);
  if (!hit || hit.distance > RIVER_REACH) return null;
  // Past its last point the bed has run out onto the pan: there is no river there.
  if (hit.segmentIndex === RIVER_LINE.length - 2 && hit.t >= 1) return null;
  const along = distanceAlong(hit);
  const bed = bedHeightAt(along);
  const halfWidth = bedHalfWidthAt(along);
  const drift = driftWeight(x, z);
  if (hit.distance <= halfWidth) return { zone: 'bed', surface: bed, distance: hit.distance, along, inDrift: drift > 0.5 };
  const slope = lerp(bankSlopeAt(along, hit.side), SANDRIVIER.drift.rampSlope, drift);
  return {
    zone: bankSideAt(along, hit.side) === 'inside' ? 'insideBank' : 'outsideBank',
    surface: bed + slope * (hit.distance - halfWidth),
    distance: hit.distance,
    along,
    inDrift: drift > 0.5,
  };
}

// Polynomial smooth minimum: rounds the bank top where the cut meets the ground.
function smoothMin(first: number, second: number, width: number): number {
  const share = Math.max(width - Math.abs(first - second), 0) / width;
  return Math.min(first, second) - (share * share * width) / 4;
}

/** Cuts the river into a height; unchanged where the river does not reach. */
export function carveRiver(height: number, x: number, z: number): number {
  const sample = riverSampleAt(x, z);
  if (!sample) return height;
  // The rounding dips a little below both surfaces; where the bed meets the salt that would be a
  // dent below the pan, the lowest ground of the map.
  return Math.max(Math.min(height, PAN_LEVEL), smoothMin(height, sample.surface, BANK_ROUNDING));
}

// ── Die Sprong (J6) ──────────────────────────────────────────────────────────────────
// Across the bend: a kicker from the inside plain whose lip stands `gap` metres short of a raised
// landing on the outside bank. The kicker's causeway reaches a few metres into the bed.
const KICKER_FRONT_SLOPE = 1.5;
const FILL_SMOOTHING = 0.6;
const FILL_SIDE_SLOPE = 1;
const LANDING = { extraHalfWidth: 4, runOffSlope: 0.1, sideSlope: 0.6 };
/** Where the landing's front edge sits past the far edge of the bed, metres. */
const LANDING_SET_BACK = 2;
/** The kicker's approach starts this far past the inside edge of the bed, on the plain. */
const APPROACH_PAST_BED = 45;

interface SprongFrame {
  centre: Point2;
  /** Unit vector across the river, from the inside bank to the outside bank. */
  across: Point2;
  /** Unit vector along the river. */
  along: Point2;
  lip: number;
  lipHeight: number;
  rampStart: number;
  approachStart: number;
  landingEdge: number;
  landingHeight: number;
}

const SPRONG: SprongFrame = (() => {
  const hit = nearestOnPolyline(RIVER_LINE, RIVER_LINE.slice(0, -1).map((_point, index) => index), DIE_SPRONG.x, DIE_SPRONG.z);
  if (!hit || hit.distance > 40) throw new Error('river: Die Sprong is not on the river');
  const distance = distanceAlong(hit);
  const start = RIVER_LINE[hit.segmentIndex];
  const end = RIVER_LINE[hit.segmentIndex + 1];
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const along = { x: (end.x - start.x) / length, z: (end.z - start.z) / length };
  // The +1 side of the line is to the left of its direction; the inside of the bend is the side
  // the line turns toward.
  const insideSign = Math.sign(riverCurvatureAt(distance)) || 1;
  const across = { x: along.z * insideSign, z: -along.x * insideSign };
  const centre = { x: hit.x, z: hit.z };
  const halfWidth = bedHalfWidthAt(distance);
  const landingEdge = halfWidth + LANDING_SET_BACK;
  const lip = landingEdge - DIE_SPRONG.gap;
  const approachStart = -(halfWidth + APPROACH_PAST_BED);
  const plain = baseGroundHeight(centre.x + across.x * approachStart, centre.z + across.z * approachStart);
  const lipHeight = plain + DIE_SPRONG.rampHeight;
  return {
    centre,
    across,
    along,
    lip,
    lipHeight,
    rampStart: lip - DIE_SPRONG.rampHeight / DIE_SPRONG.rampSlope,
    approachStart,
    landingEdge,
    landingHeight: lipHeight - DIE_SPRONG.farBankDrop,
  };
})();

// Far enough that the landing's run-off has reached the ground before the layer stops looking.
const SPRONG_REACH = SPRONG.landingEdge + DIE_SPRONG.landingLength + DIE_SPRONG.rampHeight / LANDING.runOffSlope + 60;

/** The kicker and the landing of Die Sprong, raised onto a height; unchanged away from them. */
export function applyDieSprong(height: number, x: number, z: number): number {
  const dx = x - SPRONG.centre.x;
  const dz = z - SPRONG.centre.z;
  if (Math.abs(dx) > SPRONG_REACH || Math.abs(dz) > SPRONG_REACH) return height;
  const across = dx * SPRONG.across.x + dz * SPRONG.across.z;
  const sideways = Math.abs(dx * SPRONG.along.x + dz * SPRONG.along.z);
  let result = height;

  if (across >= SPRONG.approachStart) {
    const approachHeight = SPRONG.lipHeight - DIE_SPRONG.rampHeight;
    const kicker = across <= SPRONG.rampStart ? approachHeight
      : across <= SPRONG.lip ? approachHeight + DIE_SPRONG.rampSlope * (across - SPRONG.rampStart)
        : SPRONG.lipHeight - KICKER_FRONT_SLOPE * (across - SPRONG.lip);
    result = smoothMax(result, kicker - FILL_SIDE_SLOPE * Math.max(0, sideways - DIE_SPRONG.halfWidth), FILL_SMOOTHING);
  }

  const landingEnd = SPRONG.landingEdge + DIE_SPRONG.landingLength;
  const landing = across < SPRONG.landingEdge ? SPRONG.landingHeight - KICKER_FRONT_SLOPE * (SPRONG.landingEdge - across)
    : across <= landingEnd ? SPRONG.landingHeight
      : SPRONG.landingHeight - LANDING.runOffSlope * (across - landingEnd);
  const landingHalfWidth = DIE_SPRONG.halfWidth + LANDING.extraHalfWidth;
  return smoothMax(result, landing - LANDING.sideSlope * Math.max(0, sideways - landingHalfWidth), FILL_SMOOTHING);
}

// Polynomial smooth maximum: the fills meet the ground without a crease.
function smoothMax(first: number, second: number, width: number): number {
  const share = Math.max(width - Math.abs(first - second), 0) / width;
  return Math.max(first, second) + (share * share * width) / 4;
}

/** Die Sprong's lip and landing, for the jump checks. */
export const DIE_SPRONG_FRAME: Readonly<SprongFrame> = SPRONG;
