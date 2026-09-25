// src/world/worldDef.ts
// Pure queries about Klipfontein that the client, the terrain worker and the server share: the world
// size, where cars start and which way they face, the border distance, where props may not stand,
// and the placed features of a chunk. The numbers themselves live in mapLayout.
import { CHUNK_SIZE } from './chunk';
import { createNearestSegmentIndex } from './featureIndex';
import { nearestOnPolyline, type Point2 } from './polyline';
import {
  DIE_SPRONG, EERSTE_BULT, FARM_GATE, MAP_SIZE, NURSERY_WHOOPS, ROAD_SHOULDER_WIDTH, ROAD_WIDTH, SPAWN_GRID, SPAWN_RISE,
} from './mapLayout';
import { ROAD_LINES } from './terrain/roads';
import { padAt } from './terrain/pads';
import { panInsideDistance } from './terrain/pan';
import { bedHalfWidthAt, DIE_SPRONG_FRAME, riverSampleAt } from './terrain/river';
import { inDuneField } from './terrain/dunes';
import { WHOOPS_END_X, WHOOPS_START_X } from './terrain/crests';
import { nearestTrack } from './terrain/tracks';
import { inQuarryLane, poortSampleAt } from './terrain/cuts';
import { applyLandforms } from './terrain/landforms';

export { smoothstep, lerp } from './blend';
export { borderDistance, borderFaceDepth } from './terrain/border';
export { rockKindAt, type RockKind } from './terrain/landforms';

export const WORLD_SIZE = MAP_SIZE;
export const WORLD_CHUNKS = WORLD_SIZE / CHUNK_SIZE;

/** Centre of the spawn rise (Suidhek); the server builds the ground around it before anyone joins. */
export const SPAWN = { x: SPAWN_RISE.x, z: SPAWN_RISE.z } as const;

// ── spawn slots ───────────────────────────────────────────────────────
/** Where a car starts and which way it faces: forward = (sin yaw, 0, cos yaw), so north (−z) is π. */
export interface SpawnPose {
  x: number;
  z: number;
  yaw: number;
}

export const NORTH_YAW = Math.PI;
export const SPAWN_SLOT_COUNT = SPAWN_GRID.columns * SPAWN_GRID.rows;
/** A new car starts this far above the ground, the same on the client and the server. */
export const SPAWN_LIFT = 2;

/** Slot 0 is the front row's west end; slots fill the row eastward, then the next row south. */
export function spawnPoseFor(slot: number): SpawnPose {
  if (!Number.isInteger(slot) || slot < 0) throw new Error(`spawnPoseFor: a slot is a whole number ≥ 0, got ${slot}`);
  const index = slot % SPAWN_SLOT_COUNT;
  const column = index % SPAWN_GRID.columns;
  const row = Math.floor(index / SPAWN_GRID.columns);
  return {
    x: FARM_GATE.x + (column - (SPAWN_GRID.columns - 1) / 2) * SPAWN_GRID.columnSpacing,
    z: FARM_GATE.z + SPAWN_GRID.frontRowBehindGate + row * SPAWN_GRID.rowSpacing,
    yaw: NORTH_YAW,
  };
}

/** The upright rotation (a quaternion about +y) that makes a car face `yaw`. */
export function rotationForYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

// ── prop keep-clear areas ─────────────────────────────────────────────
const SPAWN_CLEARANCE = 4;
/** The J1 landing zone: straight on along the spine past the crest, this wide each side. */
const LANDING_HALF_WIDTH = 15;

/** Room kept clear before the whoops and before Die Sprong's kicker, so a car can line up. */
const RUN_IN = 100;

function inEersteBultLanding(x: number, z: number): boolean {
  // Cars reach J1 heading north (−z), so they land north of it.
  return Math.abs(x - EERSTE_BULT.x) <= LANDING_HALF_WIDTH && z <= EERSTE_BULT.z && z >= EERSTE_BULT.z - EERSTE_BULT.landingLength;
}

function inWhoopsLane(x: number, z: number): boolean {
  const lane = NURSERY_WHOOPS.lane;
  return x >= WHOOPS_START_X - RUN_IN && x <= WHOOPS_END_X + LANDING_HALF_WIDTH
    && z >= lane.minZ - LANDING_HALF_WIDTH && z <= lane.maxZ + LANDING_HALF_WIDTH;
}

function inDieSprongCorridor(x: number, z: number): boolean {
  const frame = DIE_SPRONG_FRAME;
  const dx = x - frame.centre.x;
  const dz = z - frame.centre.z;
  const across = dx * frame.across.x + dz * frame.across.z;
  const sideways = Math.abs(dx * frame.along.x + dz * frame.along.z);
  return sideways <= LANDING_HALF_WIDTH && across >= frame.approachStart - RUN_IN
    && across <= frame.landingEdge + 3 * DIE_SPRONG.landingLength;
}

/** Room kept clear on each side of a track's running surface. */
const TRACK_CLEARANCE = 2;

/**
 * True where no natural prop may stand: the spawn top, pads, the salt, the river bed, the dune
 * field (design: no solids there), the run-ins and landings of J1, J4, J6 and the quarry heaps (J7),
 * the quarry ramps, and the running surface of every track.
 */
export function isPropExcluded(x: number, z: number): boolean {
  if (Math.hypot(x - SPAWN_RISE.x, z - SPAWN_RISE.z) < SPAWN_RISE.top + SPAWN_CLEARANCE) return true;
  if (panInsideDistance(x, z) >= 0 || padAt(x, z) !== null || inEersteBultLanding(x, z)) return true;
  if (inDuneField(x, z) || inWhoopsLane(x, z) || inDieSprongCorridor(x, z)) return true;
  if (inQuarryLane(x, z) || nearestTrack(x, z, TRACK_CLEARANCE) !== null) return true;
  const river = riverSampleAt(x, z);
  return river !== null && river.distance <= bedHalfWidthAt(river.along);
}

// ── rock zones (plan v3 S3-2 reads them for its prop densities) ───────────────────────
export type RockZone = 'koppie' | 'poort' | 'ridge';

/** A landform counts as its rock zone from this share of its height up. */
const ROCK_ZONE_SHARE = 0.05;

/**
 * Which rocky zone (x, z) is in: a koppie or the Klim spur, the floor and walls of the Klipspringer
 * Poort, or the rest of the dolerite ridge. Null elsewhere.
 */
export function rockZoneAt(x: number, z: number): RockZone | null {
  const canyon = poortSampleAt(x, z);
  const landform = applyLandforms(0, x, z);
  if (canyon && landform.kind === 'ridge' && canyon.surface < landform.height + canyon.floor) return 'poort';
  if (landform.kind === 'spur' || (landform.kind === 'koppie' && landform.share > ROCK_ZONE_SHARE)) return 'koppie';
  if (landform.kind === 'ridge' && landform.share > ROCK_ZONE_SHARE) return 'ridge';
  return null;
}

// ── roads ─────────────────────────────────────────────────────────────
export const ROAD_HALF = ROAD_WIDTH / 2;
export const ROAD_SHOULDER = ROAD_SHOULDER_WIDTH;
/** The widest reach any road rule has around a centre line. */
export const ROAD_INDEX_REACH = ROAD_HALF + ROAD_SHOULDER + 6;

/** Centre lines of the graded roads (plan v3 S2-1), smoothed and resampled. */
export const GRADED_ROADS: readonly (readonly Point2[])[] = ROAD_LINES.map((line) => line.points);

/** `x`, `z` is the closest point on the road's centre line; `tangentX`, `tangentZ` its direction there. */
export interface RoadHit {
  dist: number;
  t: number;
  x: number;
  z: number;
  tangentX: number;
  tangentZ: number;
}

const ROAD_INDEX_CELL = 8;
const NEAREST_SEGMENTS = GRADED_ROADS.map((road) => createNearestSegmentIndex(road, ROAD_INDEX_REACH, ROAD_INDEX_CELL));

// For a search far from every road: runs of segments with their bounding box, so whole runs that
// cannot beat the best hit so far are skipped.
const RUN_LENGTH = 16;
interface SegmentRun {
  segments: number[];
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

const RUNS_BY_ROAD: SegmentRun[][] = GRADED_ROADS.map((road) => {
  const runs: SegmentRun[] = [];
  for (let first = 0; first < road.length - 1; first += RUN_LENGTH) {
    const segments: number[] = [];
    for (let index = first; index < Math.min(first + RUN_LENGTH, road.length - 1); index++) segments.push(index);
    const covered = road.slice(first, first + segments.length + 1);
    runs.push({
      segments,
      minX: Math.min(...covered.map((point) => point.x)),
      minZ: Math.min(...covered.map((point) => point.z)),
      maxX: Math.max(...covered.map((point) => point.x)),
      maxZ: Math.max(...covered.map((point) => point.z)),
    });
  }
  return runs;
});

function hitOn(roadIndex: number, segmentIndices: readonly number[], x: number, z: number): RoadHit | null {
  const road = GRADED_ROADS[roadIndex];
  const hit = nearestOnPolyline(road, segmentIndices, x, z);
  if (!hit) return null;
  const start = road[hit.segmentIndex];
  const end = road[hit.segmentIndex + 1];
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  return { dist: hit.distance, t: hit.t, x: hit.x, z: hit.z, tangentX: (end.x - start.x) / length, tangentZ: (end.z - start.z) / length };
}

// Roads in order, each with its segments in order, so ties resolve exactly as a full scan does.
function nearestIndexed(x: number, z: number): RoadHit | null {
  let best: RoadHit | null = null;
  for (let roadIndex = 0; roadIndex < NEAREST_SEGMENTS.length; roadIndex++) {
    const segments = NEAREST_SEGMENTS[roadIndex].query(x, z);
    if (segments.length === 0) continue;
    const hit = hitOn(roadIndex, segments, x, z);
    if (!hit || (best && hit.dist >= best.dist)) continue;
    best = hit;
  }
  return best;
}

function nearestByRuns(x: number, z: number): RoadHit | null {
  let best: RoadHit | null = null;
  for (let roadIndex = 0; roadIndex < RUNS_BY_ROAD.length; roadIndex++) {
    for (const run of RUNS_BY_ROAD[roadIndex]) {
      const gap = Math.hypot(Math.max(run.minX - x, 0, x - run.maxX), Math.max(run.minZ - z, 0, z - run.maxZ));
      if (best && gap >= best.dist) continue;
      const hit = hitOn(roadIndex, run.segments, x, z);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
  }
  return best;
}

/**
 * The closest point on any graded road, or null when there is none within `maxDistance`. With
 * `maxDistance` at most ROAD_INDEX_REACH the answer comes from the index alone.
 */
export function nearestRoad(x: number, z: number, maxDistance = Infinity): RoadHit | null {
  const near = nearestIndexed(x, z);
  if (near && near.dist <= ROAD_INDEX_REACH) return near.dist <= maxDistance ? near : null;
  if (maxDistance <= ROAD_INDEX_REACH) return null;
  const far = nearestByRuns(x, z);
  return far && far.dist <= maxDistance ? far : null;
}

// ── placed features (meshes + solid colliders) ────────────────────────
export interface BuildingBox { x: number; z: number; w: number; d: number; h: number; yaw: number; }
export interface Ramp { x: number; z: number; yaw: number; len: number; width: number; rise: number; }
export interface Landmark { kind: 'beacon' | 'windmill'; x: number; z: number; yaw: number; }

/** Solid-collider footprint of a landmark (matches its mesh base). */
export function landmarkBox(landmark: Landmark): BuildingBox {
  return landmark.kind === 'beacon'
    ? { x: landmark.x, z: landmark.z, w: 4.5, d: 4.5, h: 16, yaw: landmark.yaw }
    : { x: landmark.x, z: landmark.z, w: 3.0, d: 3.0, h: 12, yaw: landmark.yaw };
}

export interface ChunkFeatures {
  buildings: BuildingBox[];
  ramps: Ramp[];
  landmarks: Landmark[];
}

/** Features whose centre lies in chunk (cx, cz). Klipfontein has none until the dorp lands (S4). */
export function featuresInChunk(_cx: number, _cz: number): ChunkFeatures {
  return { buildings: [], ramps: [], landmarks: [] };
}
