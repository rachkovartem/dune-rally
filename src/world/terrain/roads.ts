// src/world/terrain/roads.ts
// The gravel roads (design §12.4). Each road's height profile is made once at load: the ground
// averaged over a wide disc, raised until it is never 1 m below the ground beside it, grade and
// crests limited, crown on top. Across it: 7 m surface, 2 m shoulders, a batter to the ground.
import { lerp, smoothstep } from '../blend';
import { createNearestSegmentIndex } from '../featureIndex';
import { nearestOnPolyline, smoothPolyline, type Point2 } from '../polyline';
import {
  EERSTE_BULT, ROAD_GRADING, ROAD_SHOULDER_WIDTH, ROAD_WIDTH, ROUTES,
} from '../mapLayout';
import { baseGroundHeight } from './baseGround';
import { applyPads, padWeightAt } from './pads';
import { crestProfile, EERSTE_BULT_SHAPE } from './crests';

export const ROAD_HALF_WIDTH = ROAD_WIDTH / 2;
/** From the centre line to the outer edge of the shoulder. */
export const ROAD_EDGE = ROAD_HALF_WIDTH + ROAD_SHOULDER_WIDTH;
/** The farthest any road changes the ground from its centre line. */
export const ROAD_REACH = ROAD_EDGE + ROAD_GRADING.batter.max;

export interface RoadLine {
  name: string;
  /** Smoothed centre line, points ROAD_GRADING.spacing apart (the last step may differ a little). */
  points: readonly Point2[];
  /** Distance along the line of each point, metres. */
  along: Float64Array;
  /** Height of the centre line at each point, crown included. */
  profile: Float64Array;
  /**
   * 0..1 per point: how flush the road lies with the ground under it. 1 on a pad (the pad stays
   * level) and at a road's free end (no step where the road stops); the crown fades with it.
   */
  flush: Float64Array;
}

/** The ground the roads are graded from: the base ground with the pads levelled into it. */
function padGround(x: number, z: number): number {
  return applyPads(baseGroundHeight(x, z), x, z);
}

// Rings of the averaging disc; the point count grows with the radius, so each sample stands for
// about the same area.
const DISC_RINGS: readonly { radius: number; count: number }[] = [
  { radius: 0, count: 1 },
  { radius: ROAD_GRADING.averageRadius / 3, count: 8 },
  { radius: (2 * ROAD_GRADING.averageRadius) / 3, count: 16 },
  { radius: ROAD_GRADING.averageRadius, count: 24 },
];

function discAverage(x: number, z: number): number {
  let sum = 0;
  let count = 0;
  for (const ring of DISC_RINGS) {
    for (let index = 0; index < ring.count; index++) {
      const angle = (2 * Math.PI * index) / ring.count;
      sum += padGround(x + ring.radius * Math.cos(angle), z + ring.radius * Math.sin(angle));
      count++;
    }
  }
  return sum / count;
}

/** Raises points so no step between neighbours climbs or falls more than the grade allows. */
function limitGrade(profile: Float64Array, along: Float64Array, grade: number): void {
  for (let index = 1; index < profile.length; index++) {
    profile[index] = Math.max(profile[index], profile[index - 1] - grade * (along[index] - along[index - 1]));
  }
  for (let index = profile.length - 2; index >= 0; index--) {
    profile[index] = Math.max(profile[index], profile[index + 1] - grade * (along[index + 1] - along[index]));
  }
}

// Past this distance a parabola of radius minCrestRadius has dropped far below any profile point.
const CREST_WINDOW = 200;

/**
 * Rounds every crest to at least `radius`: the new line is the upper envelope of downward parabolas
 * of that radius through every point, so it never sinks below the old line and never bends down
 * more sharply than 1 / radius. On a steady grade g it sits g²·radius / 2 higher (0.96 m at 8 %).
 */
function limitCrests(profile: Float64Array, along: Float64Array, radius: number): void {
  const source = Float64Array.from(profile);
  let windowStart = 0;
  for (let index = 0; index < profile.length; index++) {
    while (along[index] - along[windowStart] > CREST_WINDOW) windowStart++;
    let highest = source[index];
    for (let other = windowStart; other < profile.length && along[other] - along[index] <= CREST_WINDOW; other++) {
      const offset = along[other] - along[index];
      highest = Math.max(highest, source[other] - (offset * offset) / (2 * radius));
    }
    profile[index] = highest;
  }
}

function gradeRoad(name: string, rawPoints: readonly Point2[]): RoadLine {
  const points = smoothPolyline(rawPoints, ROAD_GRADING.spacing);
  const count = points.length;
  const along = new Float64Array(count);
  for (let index = 1; index < count; index++) {
    along[index] = along[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  }

  const profile = new Float64Array(count);
  const floor = new Float64Array(count);
  const ground = new Float64Array(count);
  const onPad = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const point = points[index];
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(count - 1, index + 1)];
    const length = Math.hypot(after.x - before.x, after.z - before.z);
    const sideX = -(after.z - before.z) / length;
    const sideZ = (after.x - before.x) / length;
    const probe = ROAD_GRADING.sideProbe;
    ground[index] = padGround(point.x, point.z);
    floor[index] = Math.max(
      ground[index],
      padGround(point.x + sideX * probe, point.z + sideZ * probe),
      padGround(point.x - sideX * probe, point.z - sideZ * probe),
    ) - ROAD_GRADING.maxBelowGround;
    onPad[index] = padWeightAt(point.x, point.z);
    // On a pad the road takes the pad's own height, so the grading below leads up to it.
    profile[index] = lerp(discAverage(point.x, point.z), ground[index], onPad[index]);
  }
  for (let index = 0; index < count; index++) profile[index] = Math.max(profile[index], floor[index]);
  limitGrade(profile, along, ROAD_GRADING.maxGrade);
  // Once only: each envelope pass lifts a steady grade again.
  limitCrests(profile, along, ROAD_GRADING.minCrestRadius);
  limitGrade(profile, along, ROAD_GRADING.maxGrade);

  const flush = new Float64Array(count);
  const length = along[count - 1];
  const startIsFree = isFreeEnd(points[0], name);
  const endIsFree = isFreeEnd(points[count - 1], name);
  for (let index = 0; index < count; index++) {
    const fromStart = startIsFree ? 1 - smoothstep(0, FREE_END_TAPER, along[index]) : 0;
    const fromEnd = endIsFree ? 1 - smoothstep(0, FREE_END_TAPER, length - along[index]) : 0;
    flush[index] = Math.max(onPad[index], fromStart, fromEnd);
    profile[index] = lerp(profile[index], ground[index], flush[index]);
  }

  if (name === 'Spine') addCrest(profile, points, along, EERSTE_BULT);
  for (let index = 0; index < count; index++) profile[index] += ROAD_GRADING.crownRise * (1 - flush[index]);
  return { name, points, along, profile, flush };
}

/** Over its last metres a road with a free end comes down flush with the ground. */
const FREE_END_TAPER = 60;
const JUNCTION_REACH = 5;

/** A road end that meets no other road and no pad. */
function isFreeEnd(end: Point2, name: string): boolean {
  if (padWeightAt(end.x, end.z) > 0) return false;
  return !ROUTES.some((route) => route.kind === 'road' && route.name !== name
    && route.points.some((point, index) => index > 0 && distanceToSegment(end, route.points[index - 1], point) <= JUNCTION_REACH));
}

function distanceToSegment(point: Point2, a: Point2, b: Point2): number {
  const hit = nearestOnPolyline([a, b], [0], point.x, point.z);
  if (!hit) throw new Error('roads: a two-point line has no segment');
  return hit.distance;
}

function addCrest(profile: Float64Array, points: readonly Point2[], along: Float64Array, at: Point2): void {
  const segments = points.slice(0, -1).map((_point, index) => index);
  const hit = nearestOnPolyline(points, segments, at.x, at.z);
  if (!hit || hit.distance > 1) throw new Error(`roads: the crest at (${at.x}, ${at.z}) is not on the road`);
  const centre = along[hit.segmentIndex] + hit.t * (along[hit.segmentIndex + 1] - along[hit.segmentIndex]);
  for (let index = 0; index < profile.length; index++) profile[index] += crestProfile(EERSTE_BULT_SHAPE, along[index] - centre);
}

/** Over these metres a road that ends on another road is shifted to meet it. */
const JOIN_TAPER = 80;

function distanceAlongLine(line: RoadLine, at: Point2): { distance: number; offset: number } {
  const hit = nearestOnPolyline(line.points, line.points.slice(0, -1).map((_point, index) => index), at.x, at.z);
  if (!hit) throw new Error(`roads: ${line.name} has no segment`);
  return {
    distance: line.along[hit.segmentIndex] + hit.t * (line.along[hit.segmentIndex + 1] - line.along[hit.segmentIndex]),
    offset: hit.distance,
  };
}

/**
 * Where a road ends on another road, its end is moved to the other road's height, fading out along
 * it, so the junction has no step. Where only road ends meet, they meet at their mean height.
 */
function joinRoadEnds(lines: readonly RoadLine[]): void {
  const shifts: { line: RoadLine; atStart: boolean; by: number }[] = [];
  for (const line of lines) {
    for (const atStart of [true, false]) {
      const endIndex = atStart ? 0 : line.points.length - 1;
      const end = line.points[endIndex];
      if (padWeightAt(end.x, end.z) >= 1) continue;
      const through: number[] = [];
      const ending: number[] = [line.profile[endIndex]];
      for (const other of lines) {
        if (other === line) continue;
        const { distance, offset } = distanceAlongLine(other, end);
        if (offset > JUNCTION_REACH) continue;
        const total = other.along[other.along.length - 1];
        const isEnd = distance < JUNCTION_REACH || total - distance < JUNCTION_REACH;
        (isEnd ? ending : through).push(roadProfileAt(other, distance));
      }
      if (through.length === 0 && ending.length === 1) continue;
      const heights = through.length > 0 ? through : ending;
      const target = heights.reduce((sum, value) => sum + value, 0) / heights.length;
      shifts.push({ line, atStart, by: target - line.profile[endIndex] });
    }
  }
  for (const { line, atStart, by } of shifts) {
    const total = line.along[line.along.length - 1];
    for (let index = 0; index < line.profile.length; index++) {
      const fromEnd = atStart ? line.along[index] : total - line.along[index];
      line.profile[index] += by * (1 - smoothstep(0, JOIN_TAPER, fromEnd));
    }
  }
}

/** Every graded road of the map, in the order of ROUTES. */
export const ROAD_LINES: readonly RoadLine[] = (() => {
  const lines = ROUTES.filter((route) => route.kind === 'road').map((route) => gradeRoad(route.name, route.points));
  joinRoadEnds(lines);
  return lines;
})();

function valueAlong(line: RoadLine, values: Float64Array, distance: number): number {
  const { along } = line;
  const last = along.length - 1;
  if (distance <= 0) return values[0];
  if (distance >= along[last]) return values[last];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (along[middle] <= distance) low = middle;
    else high = middle;
  }
  const share = (distance - along[low]) / (along[high] - along[low]);
  return values[low] + (values[high] - values[low]) * share;
}

/** Height of a road's centre line `distance` metres along it (clamped to its ends). */
export function roadProfileAt(line: RoadLine, distance: number): number {
  return valueAlong(line, line.profile, distance);
}

/** How far the road surface is below its centre, `distance` metres out across it (to the shoulder's edge). */
export function crossSectionDrop(distance: number): number {
  if (distance <= ROAD_HALF_WIDTH) return ROAD_GRADING.crownDrop * (distance / ROAD_HALF_WIDTH) ** 2;
  const intoShoulder = Math.min(1, (distance - ROAD_HALF_WIDTH) / ROAD_SHOULDER_WIDTH);
  return ROAD_GRADING.crownDrop + ROAD_GRADING.shoulderDrop * intoShoulder;
}

const INDEX_CELL = 8;
const NEAREST_INDEX = ROAD_LINES.map((line) => createNearestSegmentIndex(line.points, ROAD_REACH, INDEX_CELL));

/** One road's own answer for a point: its surface there, and how far the point is from it. */
function roadAnswer(line: RoadLine, segmentIndices: readonly number[], ground: number, x: number, z: number): { value: number; distance: number } | null {
  const hit = nearestOnPolyline(line.points, segmentIndices, x, z);
  if (!hit || hit.distance > ROAD_REACH) return null;
  const distance = line.along[hit.segmentIndex] + hit.t * (line.along[hit.segmentIndex + 1] - line.along[hit.segmentIndex]);
  const centre = roadProfileAt(line, distance);
  const raised = 1 - valueAlong(line, line.flush, distance);
  if (hit.distance <= ROAD_EDGE) return { value: centre - raised * crossSectionDrop(hit.distance), distance: hit.distance };
  const edge = centre - raised * crossSectionDrop(ROAD_EDGE);
  const batter = Math.min(ROAD_GRADING.batter.max, Math.max(ROAD_GRADING.batter.min, ROAD_GRADING.batter.factor * Math.abs(edge - ground)));
  return { value: lerp(edge, ground, smoothstep(0, batter, hit.distance - ROAD_EDGE)), distance: hit.distance };
}

/**
 * Grades every road near (x, z) into `ground`. Where two roads meet, each counts by the inverse
 * fourth power of its distance, so a junction blends with no step.
 */
export function applyRoads(ground: number, x: number, z: number): number {
  let weighted = 0;
  let weights = 0;
  for (let roadIndex = 0; roadIndex < ROAD_LINES.length; roadIndex++) {
    const segmentIndices = NEAREST_INDEX[roadIndex].query(x, z);
    if (segmentIndices.length === 0) continue;
    const answer = roadAnswer(ROAD_LINES[roadIndex], segmentIndices, ground, x, z);
    if (!answer) continue;
    const closeness = 1 / (answer.distance * answer.distance + 1);
    const weight = closeness * closeness;
    weighted += weight * answer.value;
    weights += weight;
  }
  return weights > 0 ? weighted / weights : ground;
}
