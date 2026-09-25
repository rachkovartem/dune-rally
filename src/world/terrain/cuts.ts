// src/world/terrain/cuts.ts
// Layer 4 of the height: the rock cuts that are not the river. The Klipspringer Poort is a canyon
// cut through the dolerite ridge along the poort track, with three rock steps in its floor. The
// Gruisgat is an old gravel quarry: a pit with a flat floor, two ramps out, and gravel heaps as jumps.
import { lerp, smoothstep } from '../blend';
import { createNearestSegmentIndex } from '../featureIndex';
import { nearestOnPolyline, smoothPolyline, type Point2 } from '../polyline';
import {
  GRUISGAT, KLIPSPRINGER_POORT, ROUTES, TRACK_SPACING, type CompassDirection, type QuarryHeap,
} from '../mapLayout';
import { microRelief, plainHeight } from './basePlain';
import { ridgeRiseAt } from './landforms';

/** Ground before any landform or cut: the plain with its fine relief. */
const plainGround = (x: number, z: number): number => plainHeight(x, z) + microRelief(x, z);

// ── Klipspringer Poort ───────────────────────────────────────────────────────────────
const POORT_ROUTE = ROUTES.find((route) => route.name === 'Klipspringer Poort');
if (!POORT_ROUTE) throw new Error('cuts: the Klipspringer Poort track is missing from ROUTES');

/** The poort track's centre line, exactly as the track grading smooths it. */
export const POORT_TRACK_LINE: readonly Point2[] = smoothPolyline(POORT_ROUTE.points, TRACK_SPACING);

/** The ridge counts as crossed where it raises the track's line by more than this. */
const RIDGE_NOTICED = 0.5;

interface Canyon {
  /** The part of the track line the canyon follows. */
  points: readonly Point2[];
  along: Float64Array;
  length: number;
  /** Floor height at each end: the plain there. */
  startLevel: number;
  endLevel: number;
  /** Sum of the rock steps, all dropping toward the canyon's end. */
  totalStep: number;
}

const CANYON: Canyon = (() => {
  let first = -1;
  let last = -1;
  POORT_TRACK_LINE.forEach((point, index) => {
    if (ridgeRiseAt(point.x, point.z) <= RIDGE_NOTICED) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) throw new Error('cuts: the poort track never crosses the dolerite ridge');
  const margin = Math.round(KLIPSPRINGER_POORT.endMargin / TRACK_SPACING);
  const start = Math.max(0, first - margin);
  const end = Math.min(POORT_TRACK_LINE.length - 1, last + margin);
  const points = POORT_TRACK_LINE.slice(start, end + 1);
  const along = new Float64Array(points.length);
  for (let index = 1; index < points.length; index++) {
    along[index] = along[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  }
  const startPoint = points[0];
  const endPoint = points[points.length - 1];
  return {
    points,
    along,
    length: along[along.length - 1],
    startLevel: plainGround(startPoint.x, startPoint.z),
    endLevel: plainGround(endPoint.x, endPoint.z),
    totalStep: KLIPSPRINGER_POORT.steps.reduce((sum, step) => sum + step.height, 0),
  };
})();

/** How far down the rock steps have taken the floor `distance` metres into the canyon. */
function stepsDropped(distance: number): number {
  let dropped = 0;
  for (const step of KLIPSPRINGER_POORT.steps) {
    const at = step.at * CANYON.length;
    dropped += step.height * smoothstep(at - KLIPSPRINGER_POORT.stepRun / 2, at + KLIPSPRINGER_POORT.stepRun / 2, distance);
  }
  return dropped;
}

/** Height of the canyon floor `distance` metres from its north end. */
export function poortFloorAt(distance: number): number {
  const share = Math.min(1, Math.max(0, distance / CANYON.length));
  return lerp(CANYON.startLevel, CANYON.endLevel + CANYON.totalStep, share) - stepsDropped(distance);
}

/** Half the floor's width `distance` metres from the canyon's north end. */
export function poortHalfWidthAt(distance: number): number {
  const { width, tightestAt, tighteningLength } = KLIPSPRINGER_POORT;
  const fromTightest = Math.abs(distance / CANYON.length - tightestAt);
  return lerp(width.narrowest, width.wide, smoothstep(0, tighteningLength / 2, fromTightest)) / 2;
}

/** Where the floor meets the wall, the wall starts to rise over this many metres. */
const WALL_ROUNDING = 1;
const MAX_WALL_HEIGHT = 60;
const CANYON_REACH = KLIPSPRINGER_POORT.width.wide / 2 + WALL_ROUNDING + MAX_WALL_HEIGHT / KLIPSPRINGER_POORT.wallSlope;
const CANYON_INDEX = createNearestSegmentIndex(CANYON.points, CANYON_REACH, 8);

export interface PoortSample {
  /** Metres from the canyon's north end along its centre line, and from that line. */
  along: number;
  distance: number;
  floor: number;
  /** Height of the cut surface: the canyon floor, then its walls. */
  surface: number;
}

/** The canyon's cut near (x, z), or null where it does not reach. */
export function poortSampleAt(x: number, z: number): PoortSample | null {
  const segments = CANYON_INDEX.query(x, z);
  if (segments.length === 0) return null;
  const hit = nearestOnPolyline(CANYON.points, segments, x, z);
  if (!hit || hit.distance > CANYON_REACH) return null;
  const along = CANYON.along[hit.segmentIndex] + hit.t * (CANYON.along[hit.segmentIndex + 1] - CANYON.along[hit.segmentIndex]);
  // Past either end the distance is taken from the end point, so the walls close round the end.
  const floor = poortFloorAt(along);
  const past = hit.distance - poortHalfWidthAt(along);
  const rise = past <= -WALL_ROUNDING ? 0 : past >= WALL_ROUNDING ? past : (past + WALL_ROUNDING) ** 2 / (4 * WALL_ROUNDING);
  return { along, distance: hit.distance, floor, surface: floor + KLIPSPRINGER_POORT.wallSlope * rise };
}

/** Cuts the poort canyon into a height; unchanged away from it. */
export function carvePoort(height: number, x: number, z: number): number {
  const sample = poortSampleAt(x, z);
  return sample ? Math.min(height, sample.surface) : height;
}

/** Length of the canyon along the track, metres. */
export const POORT_LENGTH = CANYON.length;

export interface PoortStep {
  /** Metres from the canyon's north end, where on the ground, and how far the floor drops there. */
  along: number;
  point: Point2;
  height: number;
}

function canyonPointAt(distance: number): Point2 {
  for (let index = 1; index < CANYON.points.length; index++) {
    if (CANYON.along[index] < distance) continue;
    const from = CANYON.points[index - 1];
    const to = CANYON.points[index];
    const share = (distance - CANYON.along[index - 1]) / (CANYON.along[index] - CANYON.along[index - 1]);
    return { x: lerp(from.x, to.x, share), z: lerp(from.z, to.z, share) };
  }
  throw new Error(`cuts: ${distance} m is past the end of the poort canyon`);
}

/** The rock steps of the canyon floor (J8), from north to south. */
export const POORT_STEPS: readonly PoortStep[] = KLIPSPRINGER_POORT.steps.map((step) => ({
  along: step.at * CANYON.length,
  point: canyonPointAt(step.at * CANYON.length),
  height: step.height,
}));

/** True where (x, z) lies in the cut of the canyon: on its floor or its walls, below the rock around it. */
export function inPoort(x: number, z: number, height: number): boolean {
  const sample = poortSampleAt(x, z);
  return sample !== null && sample.along > 0 && sample.along < CANYON.length && height <= sample.surface + CUT_TOLERANCE
    && ridgeRiseAt(x, z) > RIDGE_NOTICED;
}

/** The cut surface counts as the canyon up to this far above it (the rounded foot of the wall). */
const CUT_TOLERANCE = 0.1;

// ── Gruisgat ─────────────────────────────────────────────────────────────────────────
const RIM_HALF = { x: GRUISGAT.width / 2, z: GRUISGAT.depth / 2 };
/** The flat floor: the rim rectangle moved in by the wall's width on every side. */
export const QUARRY_FLOOR = {
  minX: GRUISGAT.x - RIM_HALF.x + GRUISGAT.wallWidth,
  maxX: GRUISGAT.x + RIM_HALF.x - GRUISGAT.wallWidth,
  minZ: GRUISGAT.z - RIM_HALF.z + GRUISGAT.wallWidth,
  maxZ: GRUISGAT.z + RIM_HALF.z - GRUISGAT.wallWidth,
} as const;

const LEVEL_SAMPLE_STEP = 4;

/** The floor lies the pit's depth below the mean plain inside the rim. */
export const QUARRY_FLOOR_LEVEL = (() => {
  let sum = 0;
  let count = 0;
  for (let x = GRUISGAT.x - RIM_HALF.x; x <= GRUISGAT.x + RIM_HALF.x; x += LEVEL_SAMPLE_STEP) {
    for (let z = GRUISGAT.z - RIM_HALF.z; z <= GRUISGAT.z + RIM_HALF.z; z += LEVEL_SAMPLE_STEP) {
      sum += plainGround(x, z);
      count++;
    }
  }
  return sum / count - GRUISGAT.pitDepth;
})();

/** Metres outside the flat floor; 0 on it. */
export function distanceOutsideQuarryFloor(x: number, z: number): number {
  const dx = Math.max(QUARRY_FLOOR.minX - x, 0, x - QUARRY_FLOOR.maxX);
  const dz = Math.max(QUARRY_FLOOR.minZ - z, 0, z - QUARRY_FLOOR.maxZ);
  return Math.hypot(dx, dz);
}

const DIRECTIONS: Readonly<Record<CompassDirection, Point2>> = {
  north: { x: 0, z: -1 },
  east: { x: 1, z: 0 },
  south: { x: 0, z: 1 },
  west: { x: -1, z: 0 },
};

interface QuarryRampFrame {
  /** Where the ramp meets the floor, and the unit vector up the ramp, out of the pit. */
  foot: Point2;
  out: Point2;
}

function rampFoot(side: CompassDirection, at: number): Point2 {
  switch (side) {
    case 'west': return { x: QUARRY_FLOOR.minX, z: at };
    case 'east': return { x: QUARRY_FLOOR.maxX, z: at };
    case 'north': return { x: at, z: QUARRY_FLOOR.minZ };
    case 'south': return { x: at, z: QUARRY_FLOOR.maxZ };
  }
}

const RAMP_FRAMES: readonly QuarryRampFrame[] = GRUISGAT.ramps.map((ramp) => ({ foot: rampFoot(ramp.side, ramp.at), out: DIRECTIONS[ramp.side] }));

/** Metres up a ramp (from its foot) and across it (from its centre line). */
function rampFrameAt(frame: QuarryRampFrame, x: number, z: number): { up: number; across: number } {
  const dx = x - frame.foot.x;
  const dz = z - frame.foot.z;
  return { up: dx * frame.out.x + dz * frame.out.z, across: Math.abs(dx * frame.out.z - dz * frame.out.x) };
}

/**
 * A ramp's corridor applied to `pit` (the pit so far, `height` the ground before it): the running
 * line climbs from the floor at the ramp's slope until it meets the ground, cut into the rim and
 * built up over the wall's toe, with side faces at the ramp's side slope. Behind the foot it does nothing.
 */
function applyRamp(frame: QuarryRampFrame, pit: number, height: number, x: number, z: number): number {
  const { up, across } = rampFrameAt(frame, x, z);
  if (up < 0) return pit;
  const { slope, halfWidth, sideSlope } = GRUISGAT.ramp;
  const line = Math.min(height, QUARRY_FLOOR_LEVEL + slope * up);
  const side = sideSlope * Math.max(0, across - halfWidth);
  return Math.min(Math.max(pit, line - side), line + side);
}

interface HeapFrame {
  heap: QuarryHeap;
  launch: Point2;
  base: number;
}

const HEAP_FRAMES: readonly HeapFrame[] = GRUISGAT.heaps.map((heap) => ({
  heap,
  launch: DIRECTIONS[heap.launch],
  base: heap.base === 'floor' ? QUARRY_FLOOR_LEVEL : plainGround(heap.lip.x, heap.lip.z),
}));

/** Metres ahead of a heap's lip (in its launch direction) and to the side of its axis. */
function heapFrameAt(frame: HeapFrame, x: number, z: number): { ahead: number; across: number } {
  const dx = x - frame.heap.lip.x;
  const dz = z - frame.heap.lip.z;
  return { ahead: dx * frame.launch.x + dz * frame.launch.z, across: Math.abs(dx * frame.launch.z - dz * frame.launch.x) };
}

/** Surface of a heap: a straight ramp up to the lip, a steep back, steep sides. */
function heapSurface(frame: HeapFrame, x: number, z: number): number {
  const { ahead, across } = heapFrameAt(frame, x, z);
  const { rampSlope, backSlope, sideSlope, topHalfWidth } = GRUISGAT.heap;
  // Raised by what the rounding takes off the lip, so the lip keeps the heap's full height.
  const height = frame.heap.height + HEAP_EDGE_ROUNDING / 4;
  const along = ahead <= 0 ? height + rampSlope * ahead : height - backSlope * ahead;
  const side = height - sideSlope * Math.max(0, across - topHalfWidth);
  return frame.base + smoothMin(along, side, HEAP_EDGE_ROUNDING);
}

/** The edges of a heap are rounded over this many metres; its lip loses a quarter of it in height. */
const HEAP_EDGE_ROUNDING = 1.2;
/** Where a heap meets the ground under it, the corner is rounded over this many metres. */
const HEAP_FOOT_ROUNDING = 0.8;

function smoothMin(first: number, second: number, width: number): number {
  const share = Math.max(width - Math.abs(first - second), 0) / width;
  return Math.min(first, second) - (share * share * width) / 4;
}

function smoothMax(first: number, second: number, width: number): number {
  const share = Math.max(width - Math.abs(first - second), 0) / width;
  return Math.max(first, second) + (share * share * width) / 4;
}

/** Length of a heap's ramp, from its foot to its lip. */
export function heapRampLength(heap: QuarryHeap): number {
  return heap.height / GRUISGAT.heap.rampSlope;
}

// The pit, its ramp trenches and the rim heaps all lie within this box.
const QUARRY_REACH = 40;
const QUARRY_BOX = {
  minX: GRUISGAT.x - RIM_HALF.x - QUARRY_REACH,
  maxX: GRUISGAT.x + RIM_HALF.x + QUARRY_REACH,
  minZ: GRUISGAT.z - RIM_HALF.z - QUARRY_REACH,
  maxZ: GRUISGAT.z + RIM_HALF.z + QUARRY_REACH,
} as const;

const inQuarryBox = (x: number, z: number): boolean =>
  x >= QUARRY_BOX.minX && x <= QUARRY_BOX.maxX && z >= QUARRY_BOX.minZ && z <= QUARRY_BOX.maxZ;

/** Digs the Gruisgat into a height and raises its heaps; unchanged away from the quarry. */
export function applyQuarry(height: number, x: number, z: number): number {
  if (!inQuarryBox(x, z)) return height;
  let result = Math.min(height, lerp(QUARRY_FLOOR_LEVEL, height, smoothstep(0, GRUISGAT.wallWidth, distanceOutsideQuarryFloor(x, z))));
  for (const frame of RAMP_FRAMES) result = applyRamp(frame, result, height, x, z);
  for (const frame of HEAP_FRAMES) result = smoothMax(result, heapSurface(frame, x, z), HEAP_FOOT_ROUNDING);
  return result;
}

export type QuarryPart = 'floor' | 'wall' | 'ramp' | 'heap';

/** Which part of the quarry (x, z) is on, or null outside it. Heaps win over what is under them. */
export function quarryPartAt(x: number, z: number): QuarryPart | null {
  if (!inQuarryBox(x, z)) return null;
  for (const frame of HEAP_FRAMES) {
    const { ahead, across } = heapFrameAt(frame, x, z);
    const { sideSlope, backSlope, topHalfWidth } = GRUISGAT.heap;
    const { height } = frame.heap;
    if (ahead >= -heapRampLength(frame.heap) && ahead <= height / backSlope && across <= topHalfWidth + height / sideSlope) return 'heap';
  }
  for (const frame of RAMP_FRAMES) {
    const { up, across } = rampFrameAt(frame, x, z);
    if (up >= 0 && across <= GRUISGAT.ramp.halfWidth && QUARRY_FLOOR_LEVEL + GRUISGAT.ramp.slope * up < plainGround(x, z)) return 'ramp';
  }
  const outside = distanceOutsideQuarryFloor(x, z);
  if (outside === 0) return 'floor';
  return outside < GRUISGAT.wallWidth ? 'wall' : null;
}

export interface HeapLanding {
  heap: QuarryHeap;
  /** Straight metres of flat floor from the lip in the launch direction to the far wall. */
  clearLength: number;
}

/** For each heap, how much floor lies straight ahead of it before the far wall (J7 landing zones). */
export const HEAP_LANDINGS: readonly HeapLanding[] = HEAP_FRAMES.map((frame) => {
  const { lip } = frame.heap;
  const { launch } = frame;
  const toFarEdge = launch.x < 0 ? lip.x - QUARRY_FLOOR.minX
    : launch.x > 0 ? QUARRY_FLOOR.maxX - lip.x
      : launch.z < 0 ? lip.z - QUARRY_FLOOR.minZ : QUARRY_FLOOR.maxZ - lip.z;
  return { heap: frame.heap, clearLength: toFarEdge };
});

/** Half the width of a heap's run-in and landing lane, metres. */
const LANE_HALF_WIDTH = 8;
/** Straight room kept clear on the plain before a ramp or a heap, so a car can line up at speed. */
const RUN_IN = 40;

/**
 * True on the quarry's driving lines, where nothing may stand: every heap, the run-in behind it,
 * the lane in front of its lip to the far wall, and both ramps out.
 */
export function inQuarryLane(x: number, z: number): boolean {
  if (x < QUARRY_BOX.minX - RUN_IN || x > QUARRY_BOX.maxX + RUN_IN || z < QUARRY_BOX.minZ - RUN_IN || z > QUARRY_BOX.maxZ + RUN_IN) return false;
  for (const frame of HEAP_FRAMES) {
    const { ahead, across } = heapFrameAt(frame, x, z);
    const landing = HEAP_LANDINGS.find((entry) => entry.heap === frame.heap);
    if (!landing) throw new Error('cuts: a heap has no landing');
    const runIn = heapRampLength(frame.heap) + RUN_IN;
    if (across <= LANE_HALF_WIDTH && ahead >= -runIn && ahead <= landing.clearLength) return true;
  }
  return RAMP_FRAMES.some((frame) => {
    const { up, across } = rampFrameAt(frame, x, z);
    return across <= LANE_HALF_WIDTH && up >= -LANE_HALF_WIDTH && up <= GRUISGAT.pitDepth / GRUISGAT.ramp.slope + RUN_IN;
  });
}
