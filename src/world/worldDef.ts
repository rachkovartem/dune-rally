// src/world/worldDef.ts
// Pure queries about Klipfontein that the client, the terrain worker and the server share: the world
// size, where cars start and which way they face, the border distance, where props may not stand,
// and the placed features of a chunk. The numbers themselves live in mapLayout.
import { CHUNK_SIZE } from './chunk';
import { createFeatureIndex } from './featureIndex';
import { nearestOnPolyline, type Point2 } from './polyline';
import { FARM_GATE, MAP_SIZE, ROAD_SHOULDER_WIDTH, ROAD_WIDTH, SPAWN_GRID, SPAWN_RISE } from './mapLayout';

export { smoothstep, lerp } from './blend';
export { borderDistance, borderFaceDepth } from './terrain/border';

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

/** True where no natural prop may stand: the spawn top now; roads, pads, the pan and water later. */
export function isPropExcluded(x: number, z: number): boolean {
  return Math.hypot(x - SPAWN_RISE.x, z - SPAWN_RISE.z) < SPAWN_RISE.top + SPAWN_CLEARANCE;
}

// ── roads ─────────────────────────────────────────────────────────────
export const ROAD_HALF = ROAD_WIDTH / 2;
export const ROAD_SHOULDER = ROAD_SHOULDER_WIDTH;
/** The widest reach any road rule has around a centre line. */
export const ROAD_INDEX_REACH = ROAD_HALF + ROAD_SHOULDER + 6;

/** Road centre lines graded into the ground. Empty until the roads land (plan v3 step S2). */
export const GRADED_ROADS: readonly (readonly Point2[])[] = [];

/** `x`, `z` is the closest point on the road's centre line. */
export interface RoadHit {
  dist: number;
  t: number;
  x: number;
  z: number;
}

interface RoadSegment {
  roadIndex: number;
  segmentIndex: number;
}

const ROAD_SEGMENTS: RoadSegment[] = GRADED_ROADS.flatMap((road, roadIndex) =>
  road.slice(0, -1).map((_waypoint, segmentIndex) => ({ roadIndex, segmentIndex })));

const ROAD_INDEX = createFeatureIndex(ROAD_SEGMENTS, ({ roadIndex, segmentIndex }) => {
  const a = GRADED_ROADS[roadIndex][segmentIndex];
  const b = GRADED_ROADS[roadIndex][segmentIndex + 1];
  return {
    minX: Math.min(a.x, b.x) - ROAD_INDEX_REACH,
    minZ: Math.min(a.z, b.z) - ROAD_INDEX_REACH,
    maxX: Math.max(a.x, b.x) + ROAD_INDEX_REACH,
    maxZ: Math.max(a.z, b.z) + ROAD_INDEX_REACH,
  };
}, CHUNK_SIZE);

const ALL_SEGMENTS_BY_ROAD: number[][] = GRADED_ROADS.map((road) => road.slice(0, -1).map((_waypoint, index) => index));

// Roads in order, each with its segments in order, so ties resolve exactly as a full scan does.
function nearestAmong(segmentsByRoad: readonly (readonly number[])[], x: number, z: number): RoadHit | null {
  let best: RoadHit | null = null;
  for (let roadIndex = 0; roadIndex < segmentsByRoad.length; roadIndex++) {
    const hit = nearestOnPolyline(GRADED_ROADS[roadIndex], segmentsByRoad[roadIndex], x, z);
    if (!hit || (best && hit.distance >= best.dist)) continue;
    best = { dist: hit.distance, t: hit.t, x: hit.x, z: hit.z };
  }
  return best;
}

/**
 * The closest point on any graded road, or null when there is none within `maxDistance`. With
 * `maxDistance` at most ROAD_INDEX_REACH the answer comes from the index alone.
 */
export function nearestRoad(x: number, z: number, maxDistance = Infinity): RoadHit | null {
  const segmentsByRoad: number[][] = GRADED_ROADS.map(() => []);
  for (const candidate of ROAD_INDEX.query(x, z)) segmentsByRoad[candidate.roadIndex].push(candidate.segmentIndex);
  const near = nearestAmong(segmentsByRoad, x, z);
  if (near && near.dist <= ROAD_INDEX_REACH) return near.dist <= maxDistance ? near : null;
  if (maxDistance <= ROAD_INDEX_REACH) return null;
  const far = nearestAmong(ALL_SEGMENTS_BY_ROAD, x, z);
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
