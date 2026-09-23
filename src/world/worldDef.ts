// src/world/worldDef.ts
// THE hand-authored unique world: a bounded 512×512 desert basin ringed by cliffs, with a hub
// town, a ring road + spokes, a stunt park (ramps), a dune sea, a mesa lookout, and a salt flat.
// This is PURE data + pure queries (no RNG, no time): identical on the client and the authoritative
// server. The macro height functions feed createHeightField (so terrain mesh + both physics
// trimeshes agree), the road/town queries drive height flattening + surface painting, and the
// feature lists drive placed meshes + solid colliders.

import { CHUNK_SIZE } from './chunk';

export const WORLD_SIZE = 512;
export const WORLD_BORDER = 40;        // cliff-wall margin around the playable rectangle
export const BORDER_HEIGHT = 46;       // cliff-wall height (un-climbable → world boundary)
export const PLAYABLE_MIN = WORLD_BORDER;
export const PLAYABLE_MAX = WORLD_SIZE - WORLD_BORDER;

/** Where players spawn (the hub-town plaza). */
export const SPAWN = { x: 256, z: 262 };

// ── math helpers ──────────────────────────────────────────────────────
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function segDist(
  px: number, pz: number, ax: number, az: number, bx: number, bz: number,
): { dist: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { dist: Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t };
}

// ── HUB TOWN ──────────────────────────────────────────────────────────
export const TOWN = { x: 256, z: 256, plaza: 34, skirt: 14 };
export function townDist(x: number, z: number): number {
  return Math.hypot(x - TOWN.x, z - TOWN.z);
}

// ── MESA LOOKOUT (raised flat-topped plateau, N of town) ───────────────
export const MESA = { x: 256, z: 96, radius: 30, skirt: 26, top: 14 };
export function mesaHeight(x: number, z: number): number {
  const d = Math.hypot(x - MESA.x, z - MESA.z);
  return MESA.top * (1 - smoothstep(MESA.radius, MESA.radius + MESA.skirt, d));
}

// ── DUNE SEA (SE — big rolling crests to jump) ─────────────────────────
const DUNE = { minX: 330, maxX: 472, minZ: 316, maxZ: 466, amp: 9, feather: 28 };
export function inDuneSea(x: number, z: number): boolean {
  return x >= DUNE.minX && x <= DUNE.maxX && z >= DUNE.minZ && z <= DUNE.maxZ;
}
export function duneHeight(x: number, z: number): number {
  if (x < DUNE.minX - DUNE.feather || x > DUNE.maxX + DUNE.feather ||
      z < DUNE.minZ - DUNE.feather || z > DUNE.maxZ + DUNE.feather) return 0;
  const mask =
    smoothstep(DUNE.minX - DUNE.feather, DUNE.minX, x) * (1 - smoothstep(DUNE.maxX, DUNE.maxX + DUNE.feather, x)) *
    smoothstep(DUNE.minZ - DUNE.feather, DUNE.minZ, z) * (1 - smoothstep(DUNE.maxZ, DUNE.maxZ + DUNE.feather, z));
  const crests = (0.5 + 0.5 * Math.sin(x * 0.10)) * (0.5 + 0.5 * Math.sin(z * 0.085 + 1.3));
  return DUNE.amp * crests * mask;
}

// ── SALT FLAT (S/SW — pale speed straight) ─────────────────────────────
const SALT = { minX: 70, maxX: 300, minZ: 368, maxZ: 458 };
export function inSaltFlat(x: number, z: number): boolean {
  return x >= SALT.minX && x <= SALT.maxX && z >= SALT.minZ && z <= SALT.maxZ;
}

// ── CLIFF RING (world boundary) ────────────────────────────────────────
export function cliffHeight(x: number, z: number): number {
  const dx = Math.max(0, PLAYABLE_MIN - x, x - PLAYABLE_MAX);
  const dz = Math.max(0, PLAYABLE_MIN - z, z - PLAYABLE_MAX);
  const d = Math.max(dx, dz);
  if (d <= 0) return 0;
  return BORDER_HEIGHT * smoothstep(2, WORLD_BORDER * 0.8, d);
}

// ── ROADS (polylines; each waypoint carries its target height) ─────────
export const ROAD_HALF = 5;
export const ROAD_SHOULDER = 3;
export const ROAD_RAMP = 6;

export interface Wp { x: number; z: number; y: number; }
export const ROADS: Wp[][] = [
  // town → mesa, switchback up to the lookout
  [{ x: 256, z: 256, y: 0 }, { x: 256, z: 184, y: 0 }, { x: 256, z: 140, y: 0 },
   { x: 256, z: 130, y: 1 }, { x: 286, z: 118, y: 5 }, { x: 254, z: 107, y: 10 }, { x: 238, z: 98, y: 14 }],
  // town → stunt park (NE)
  [{ x: 256, z: 256, y: 0 }, { x: 312, z: 206, y: 0 }, { x: 366, z: 164, y: 0 }, { x: 400, z: 150, y: 0 }],
  // town → dune sea (SE)
  [{ x: 256, z: 256, y: 0 }, { x: 322, z: 300, y: 0 }, { x: 388, z: 338, y: 0 }, { x: 430, z: 360, y: 0 }],
  // town → salt flat (SW)
  [{ x: 256, z: 256, y: 0 }, { x: 200, z: 320, y: 0 }, { x: 150, z: 400, y: 0 }, { x: 120, z: 440, y: 0 }],
  // outer ring loop (just inside the cliffs), tying the zones together
  [{ x: 256, z: 140, y: 0 }, { x: 400, z: 150, y: 0 }, { x: 446, z: 256, y: 0 }, { x: 430, z: 360, y: 0 },
   { x: 300, z: 446, y: 0 }, { x: 120, z: 440, y: 0 }, { x: 78, z: 300, y: 0 }, { x: 86, z: 170, y: 0 },
   { x: 256, z: 140, y: 0 }],
];

export interface RoadHit { dist: number; ya: number; yb: number; t: number; }
export function nearestRoad(x: number, z: number): RoadHit | null {
  let best: RoadHit | null = null;
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const a = road[i];
      const b = road[i + 1];
      const s = segDist(x, z, a.x, a.z, b.x, b.z);
      if (!best || s.dist < best.dist) best = { dist: s.dist, ya: a.y, yb: b.y, t: s.t };
    }
  }
  return best;
}

// ── PLACED FEATURES (meshes + solid colliders) ─────────────────────────
export interface BuildingBox { x: number; z: number; w: number; d: number; h: number; yaw: number; }
export interface Ramp { x: number; z: number; yaw: number; len: number; width: number; rise: number; }
export interface Landmark { kind: 'beacon' | 'windmill'; x: number; z: number; yaw: number; }

// Hub-town buildings — two rows per quadrant, the N/S/E/W cross kept clear for the spoke roads.
export const BUILDINGS: BuildingBox[] = (() => {
  const out: BuildingBox[] = [];
  const lots: [number, number, number, number, number, number][] = [
    [-25, -20, 12, 10, 7, 0.05], [-14, -27, 10, 9, 5, -0.1], [-27, 12, 11, 11, 6, 0.0], [-15, 25, 9, 10, 8, 0.12],
    [25, -22, 12, 10, 9, -0.05], [14, -27, 9, 9, 5, 0.08], [27, 15, 11, 10, 6, 0.0], [16, 26, 10, 11, 7, -0.12],
    [-26, -10, 8, 8, 4, 0.0], [26, 9, 8, 8, 5, 0.0],
  ];
  for (const [dx, dz, w, d, h, yaw] of lots) {
    out.push({ x: TOWN.x + dx, z: TOWN.z + dz, w, d, h, yaw });
  }
  return out;
})();

// Stunt park — a cluster of ramps NE, rise S→XL plus a big kicker.
export const RAMPS: Ramp[] = [
  { x: 400, z: 132, yaw: Math.PI / 2, len: 12, width: 10, rise: 2.5 },
  { x: 420, z: 132, yaw: Math.PI / 2, len: 12, width: 10, rise: 4.0 },
  { x: 444, z: 132, yaw: Math.PI / 2, len: 14, width: 11, rise: 6.0 }, // big kicker
  { x: 400, z: 162, yaw: Math.PI / 2, len: 12, width: 10, rise: 3.5 },
];

export const LANDMARKS: Landmark[] = [
  { kind: 'beacon', x: 256, z: 96, yaw: 0 },   // on the mesa top
  { kind: 'windmill', x: 150, z: 178, yaw: 0.4 }, // open NW desert
];

/** Solid-collider footprint of a landmark (matches its mesh base). */
export function landmarkBox(l: Landmark): BuildingBox {
  return l.kind === 'beacon'
    ? { x: l.x, z: l.z, w: 4.5, d: 4.5, h: 16, yaw: l.yaw }
    : { x: l.x, z: l.z, w: 3.0, d: 3.0, h: 12, yaw: l.yaw };
}

export interface ChunkFeatures {
  buildings: BuildingBox[];
  ramps: Ramp[];
  landmarks: Landmark[];
}

/** Features whose centre lies in chunk (cx,cz) — each feature is returned by exactly one chunk. */
export function featuresInChunk(cx: number, cz: number): ChunkFeatures {
  const minX = cx * CHUNK_SIZE, maxX = minX + CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE, maxZ = minZ + CHUNK_SIZE;
  const inq = (x: number, z: number): boolean => x >= minX && x < maxX && z >= minZ && z < maxZ;
  return {
    buildings: BUILDINGS.filter((b) => inq(b.x, b.z)),
    ramps: RAMPS.filter((r) => inq(r.x, r.z)),
    landmarks: LANDMARKS.filter((l) => inq(l.x, l.z)),
  };
}
