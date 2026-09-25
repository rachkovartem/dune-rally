// src/world/terrain/tracks.ts
// The rock tracks (design §4): Koppie Klim, Tafelkop Pas and Klipspringer Poort. Narrower and
// steeper than the roads, and cut into the ground as well as built up: each line lies between the
// highest and the lowest line its grade allows, with a cut face above it and a fill below it.
import { lerp, smoothstep } from '../blend';
import { createNearestSegmentIndex, type NearestSegmentIndex } from '../featureIndex';
import { nearestOnPolyline, smoothPolyline, type Point2 } from '../polyline';
import { ROUTES, TRACK_GRADING, TRACK_SPACING, type TrackGrading } from '../mapLayout';
import { baseGroundHeight } from './baseGround';
import { applyPads, padWeightAt } from './pads';
import { applyRoads } from './roads';
import { poortSampleAt } from './cuts';

export interface TrackLine {
  name: string;
  grading: TrackGrading;
  points: readonly Point2[];
  along: Float64Array;
  /** Height of the graded running surface at each point, rock steps included. */
  profile: Float64Array;
  halfWidth: Float64Array;
  /**
   * 0..1 per point: 1 where the track lies flush with the ground under it (its ends, the canyon
   * floor), so there it keeps the ground's own shape, the canyon's rock steps included.
   */
  flush: Float64Array;
  /** Distances along the line of the rock steps. */
  stepsAt: readonly number[];
}

/** The ground a track is graded into: everything below it, roads and pads included. */
function groundUnderTracks(x: number, z: number): number {
  return applyRoads(applyPads(baseGroundHeight(x, z), x, z), x, z);
}

/** Over its last metres a track comes down flush with the road it ends on. */
const END_TAPER = 35;
/** The ground along the line is averaged over this many metres each way before the grade limit. */
const AVERAGE_REACH = 2;
/** Within this many metres of its end a track lies flush with a pad it ends on. */
const PAD_END_REACH = 40;
/** The last rock step stands at least this far before the end of its stretch. */
const STEPS_CLEAR_OF_END = 30;
/** A hairpin widens the running surface over this many metres before and after its apex. */
const HAIRPIN_REACH = 14;
/** On the canyon floor the track is flush with it; the flush fades in over these metres. */
const CANYON_FLUSH_FADE = 10;

function limitGradeUp(profile: Float64Array, along: Float64Array, grade: number): void {
  for (let index = 1; index < profile.length; index++) {
    profile[index] = Math.max(profile[index], profile[index - 1] - grade * (along[index] - along[index - 1]));
  }
  for (let index = profile.length - 2; index >= 0; index--) {
    profile[index] = Math.max(profile[index], profile[index + 1] - grade * (along[index + 1] - along[index]));
  }
}

function limitGradeDown(profile: Float64Array, along: Float64Array, grade: number): void {
  for (let index = 1; index < profile.length; index++) {
    profile[index] = Math.min(profile[index], profile[index - 1] + grade * (along[index] - along[index - 1]));
  }
  for (let index = profile.length - 2; index >= 0; index--) {
    profile[index] = Math.min(profile[index], profile[index + 1] + grade * (along[index + 1] - along[index]));
  }
}

/** A point this flush is a fixed point of the grading: the line passes exactly through it. */
const FIXED = 0.999;

/**
 * Moves every other point into the grade cones of the fixed points, so the grade limit that
 * follows can never lift or lower a fixed point.
 */
function keepFixedPoints(source: Float64Array, along: Float64Array, flush: Float64Array, grade: number): void {
  const count = source.length;
  const upper = new Float64Array(count).fill(Infinity);
  const lower = new Float64Array(count).fill(-Infinity);
  for (let index = 0; index < count; index++) {
    if (flush[index] < FIXED) continue;
    upper[index] = source[index];
    lower[index] = source[index];
  }
  for (let index = 1; index < count; index++) {
    const step = grade * (along[index] - along[index - 1]);
    upper[index] = Math.min(upper[index], upper[index - 1] + step);
    lower[index] = Math.max(lower[index], lower[index - 1] - step);
  }
  for (let index = count - 2; index >= 0; index--) {
    const step = grade * (along[index + 1] - along[index]);
    upper[index] = Math.min(upper[index], upper[index + 1] + step);
    lower[index] = Math.max(lower[index], lower[index + 1] - step);
  }
  for (let index = 0; index < count; index++) source[index] = Math.min(upper[index], Math.max(lower[index], source[index]));
}

/** Index of the smoothed point nearest to each raw waypoint, searched in order along the line. */
function waypointIndices(points: readonly Point2[], waypoints: readonly Point2[]): number[] {
  const indices: number[] = [];
  let from = 0;
  for (const waypoint of waypoints) {
    let best = from;
    let bestDistance = Infinity;
    for (let index = from; index < points.length; index++) {
      const distance = Math.hypot(points[index].x - waypoint.x, points[index].z - waypoint.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    indices.push(best);
    from = best;
  }
  return indices;
}

function movingAverage(values: Float64Array, along: Float64Array, reach: number): Float64Array {
  const averaged = new Float64Array(values.length);
  let start = 0;
  let end = 0;
  let sum = 0;
  for (let index = 0; index < values.length; index++) {
    while (end < values.length && along[end] - along[index] <= reach) sum += values[end++];
    while (along[index] - along[start] > reach) sum -= values[start++];
    averaged[index] = sum / (end - start);
  }
  return averaged;
}

function gradeTrack(name: string, rawPoints: readonly Point2[], grading: TrackGrading): TrackLine {
  const points = smoothPolyline(rawPoints, TRACK_SPACING);
  const count = points.length;
  const along = new Float64Array(count);
  for (let index = 1; index < count; index++) {
    along[index] = along[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  }
  const waypoints = waypointIndices(points, rawPoints);
  const ground = new Float64Array(count);
  for (let index = 0; index < count; index++) ground[index] = groundUnderTracks(points[index].x, points[index].z);

  // The ends and the canyon floor are fixed to the ground first, so the grade limit leads up to them.
  const flush = new Float64Array(count);
  const length = along[count - 1];
  // An end on a road tapers into it; an end on a pad is held by the pad's own flat top below.
  const taperStart = padWeightAt(points[0].x, points[0].z) < 1;
  const taperEnd = padWeightAt(points[count - 1].x, points[count - 1].z) < 1;
  for (let index = 0; index < count; index++) {
    const point = points[index];
    const fromEnd = Math.min(along[index], length - along[index]);
    const ends = Math.max(
      taperStart ? 1 - smoothstep(0, END_TAPER, along[index]) : 0,
      taperEnd ? 1 - smoothstep(0, END_TAPER, length - along[index]) : 0,
    );
    const canyon = poortSampleAt(point.x, point.z);
    // Past the canyon's ends the distance grows from its end point, so the flush fades out there.
    const inCanyon = canyon ? 1 - smoothstep(0, CANYON_FLUSH_FADE, canyon.distance) : 0;
    // A track that ends on a pad lies on its flat top and is graded up to it across the pad's
    // blend; one that only passes a pad keeps its own line.
    const onEndPad = fromEnd <= PAD_END_REACH && padWeightAt(point.x, point.z) >= 1 ? 1 : 0;
    flush[index] = Math.max(ends, inCanyon, onEndPad);
  }
  const averaged = movingAverage(ground, along, AVERAGE_REACH);
  const high = new Float64Array(count);
  for (let index = 0; index < count; index++) high[index] = lerp(averaged[index], ground[index], flush[index]);
  keepFixedPoints(high, along, flush, grading.maxGrade);
  const low = Float64Array.from(high);
  limitGradeUp(high, along, grading.maxGrade);
  limitGradeDown(low, along, grading.maxGrade);
  const profile = new Float64Array(count);
  for (let index = 0; index < count; index++) profile[index] = lerp(low[index], high[index], grading.fillShare);

  if (grading.steadyClimb) {
    const from = waypoints[grading.steadyClimb.from];
    const to = waypoints[grading.steadyClimb.to];
    const rise = profile[to] - profile[from];
    for (let index = from + 1; index <= to; index++) {
      profile[index] = profile[from] + (rise * (along[index] - along[from])) / (along[to] - along[from]);
    }
  }

  const stepsAt: number[] = [];
  if (grading.rockSteps) {
    const { count: stepCount, height, run, from, to } = grading.rockSteps;
    const start = along[waypoints[from]];
    const end = along[waypoints[to]] - STEPS_CLEAR_OF_END;
    for (let step = 0; step < stepCount; step++) stepsAt.push(start + ((step + 0.5) * (end - start)) / stepCount);
    // The steps take over part of the climb: between them the line climbs that much less, so the
    // track meets the same ground at both ends of the stepped part.
    for (let index = 0; index < count; index++) {
      let raised = 0;
      for (const at of stepsAt) raised += height * smoothstep(at - run / 2, at + run / 2, along[index]);
      const share = Math.min(1, Math.max(0, (along[index] - start) / (end - start)));
      profile[index] += raised - height * stepCount * share;
    }
  }

  const halfWidth = new Float64Array(count).fill(grading.halfWidth);
  for (const waypoint of grading.hairpins) {
    const apex = along[waypoints[waypoint]];
    for (let index = 0; index < count; index++) {
      const near = 1 - smoothstep(0, HAIRPIN_REACH, Math.abs(along[index] - apex));
      halfWidth[index] = Math.max(halfWidth[index], lerp(grading.halfWidth, grading.hairpinHalfWidth, near));
    }
  }
  return { name, grading, points, along, profile, halfWidth, flush, stepsAt };
}

/** Every graded track of the map, in the order of ROUTES. */
export const TRACK_LINES: readonly TrackLine[] = ROUTES.filter((route) => route.kind === 'track').map((route) => {
  const grading = TRACK_GRADING[route.name];
  if (!grading) throw new Error(`tracks: no grading for the track "${route.name}"`);
  return gradeTrack(route.name, route.points, grading);
});

// ── pieces: a track split at its hairpins, so no piece ever passes close to itself ────
/**
 * Beyond the running surface a track changes the ground at most this far out; over the last
 * metres its faces fade into the ground, so the reach never shows as a step.
 */
const TRACK_SIDE_REACH = 18;
const SIDE_FADE = 6;
const INDEX_CELL = 8;

interface TrackPiece {
  line: TrackLine;
  /** The piece's own points; its segment i is the line's segment `firstSegment + i`. */
  points: readonly Point2[];
  index: NearestSegmentIndex;
  firstSegment: number;
}

const PIECES: readonly TrackPiece[] = TRACK_LINES.flatMap((line) => {
  const cuts = [0, ...waypointIndices(line.points, hairpinApexes(line)), line.points.length - 1];
  const pieces: TrackPiece[] = [];
  const widest = Math.max(...line.halfWidth);
  for (let piece = 0; piece < cuts.length - 1; piece++) {
    const from = cuts[piece];
    const to = cuts[piece + 1];
    if (to <= from) continue;
    const piecePoints = line.points.slice(from, to + 1);
    pieces.push({ line, points: piecePoints, index: createNearestSegmentIndex(piecePoints, widest + TRACK_SIDE_REACH, INDEX_CELL), firstSegment: from });
  }
  return pieces;
});

function hairpinApexes(line: TrackLine): Point2[] {
  const route = ROUTES.find((candidate) => candidate.name === line.name);
  if (!route) throw new Error(`tracks: the route "${line.name}" is gone`);
  return line.grading.hairpins.map((waypoint) => route.points[waypoint]);
}

export interface TrackHit {
  line: TrackLine;
  /** Metres from the centre line, and along it from the track's start. */
  distance: number;
  along: number;
  halfWidth: number;
  /** Height of the graded running surface there, and how flush the track lies with the ground. */
  graded: number;
  flush: number;
}

/** A per-point value on segment `index`, `share` of the way to its end. */
function valueAt(values: Float64Array, index: number, share: number): number {
  return values[index] + share * (values[index + 1] - values[index]);
}

function pieceHit(piece: TrackPiece, x: number, z: number): TrackHit | null {
  const local = piece.index.query(x, z);
  if (local.length === 0) return null;
  const hit = nearestOnPolyline(piece.points, local, x, z);
  if (!hit) return null;
  const { line } = piece;
  const index = hit.segmentIndex + piece.firstSegment;
  const halfWidth = valueAt(line.halfWidth, index, hit.t);
  if (hit.distance > halfWidth + TRACK_SIDE_REACH) return null;
  return {
    line,
    distance: hit.distance,
    along: valueAt(line.along, index, hit.t),
    halfWidth,
    graded: valueAt(line.profile, index, hit.t),
    flush: valueAt(line.flush, index, hit.t),
  };
}

/** The nearest track to (x, z) within `maxPastEdge` metres of its running surface's edge, or null. */
export function nearestTrack(x: number, z: number, maxPastEdge: number): TrackHit | null {
  let best: TrackHit | null = null;
  for (const piece of PIECES) {
    const hit = pieceHit(piece, x, z);
    if (!hit || hit.distance - hit.halfWidth > maxPastEdge) continue;
    if (!best || hit.distance - hit.halfWidth < best.distance - best.halfWidth) best = hit;
  }
  return best;
}

/** Smoothing of the cut and fill edges, as a share of the distance past the running surface. */
const EDGE_SMOOTHING = 0.5;
const MAX_EDGE_SMOOTHING = 1;

function smoothMax(first: number, second: number, width: number): number {
  if (width <= 0) return Math.max(first, second);
  const share = Math.max(width - Math.abs(first - second), 0) / width;
  return Math.max(first, second) + (share * share * width) / 4;
}

function smoothMin(first: number, second: number, width: number): number {
  if (width <= 0) return Math.min(first, second);
  const share = Math.max(width - Math.abs(first - second), 0) / width;
  return Math.min(first, second) - (share * share * width) / 4;
}

/** A track's own answer for a point: the running surface, or the ground held between cut and fill faces. */
function trackAnswer(hit: TrackHit, ground: number): number {
  const surface = lerp(hit.graded, ground, hit.flush);
  const past = hit.distance - hit.halfWidth;
  if (past <= 0) return surface;
  const { cutSlope, fillSlope } = hit.line.grading;
  // The smoothing grows from nothing at the edge, so the surface meets the faces with no step.
  const smoothing = Math.min(MAX_EDGE_SMOOTHING, EDGE_SMOOTHING * past);
  const filled = smoothMax(ground, surface - fillSlope * past, smoothing);
  const held = smoothMin(filled, surface + cutSlope * past, smoothing);
  return lerp(held, ground, smoothstep(TRACK_SIDE_REACH - SIDE_FADE, TRACK_SIDE_REACH, past));
}

/**
 * Grades every track near (x, z) into `ground`. Where pieces meet (junctions, hairpins, two legs
 * of the Pas side by side), each counts by the inverse fourth power of its distance, as the roads do.
 */
export function applyTracks(ground: number, x: number, z: number): number {
  let weighted = 0;
  let weights = 0;
  for (const piece of PIECES) {
    const hit = pieceHit(piece, x, z);
    if (!hit) continue;
    const closeness = 1 / (hit.distance * hit.distance + 1);
    const weight = closeness * closeness;
    weighted += weight * trackAnswer(hit, ground);
    weights += weight;
  }
  return weights > 0 ? weighted / weights : ground;
}

/** True within `margin` metres of a rock step on a track's running surface. */
export function onTrackStep(hit: TrackHit, margin: number): boolean {
  return hit.distance <= hit.halfWidth && hit.line.stepsAt.some((at) => Math.abs(at - hit.along) <= margin);
}
