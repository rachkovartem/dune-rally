// src/render/scatter.ts
import * as THREE from 'three';
import { mulberry32 } from '../world/rng';
import { CHUNK_SIZE } from '../world/chunk';
import { terrainSurfaceHeight } from '../world/chunkGeometry';
import { surfaceSampleAt } from '../world/surfaceSample';
import * as W from '../world/worldDef';
import type { Height2D } from '../world/noise';
import type { Biome, Cover } from '../world/biome';
import type { PropMaterials } from './propMaterials';
import { BOULDER_IDS, placePolyProp, type PolyPropId, type SolidProp } from './polyProps';
import { visualTerrainHeight } from './horizonShape';

function standardMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
}

// Fallback flat-colour materials, used until `setPropMaterials` swaps in the loaded PBR sets —
// mutable bindings (not `const`) so every builder function below picks up the swap immediately,
// the same pattern `terrainMesh.ts` uses for its own shared material.
let M_WALL: THREE.Material[] = [
  standardMaterial(0xb89b72),
  standardMaterial(0xa67c52),
  standardMaterial(0xc9b489),
  standardMaterial(0x9c8466),
];
let M_ROOF: THREE.Material = standardMaterial(0x6b4f3a);
let M_RAMP: THREE.Material = (() => { const m = standardMaterial(0xb05a2e); m.side = THREE.DoubleSide; return m; })();
let M_BEACON: THREE.Material = standardMaterial(0xb6bcc4);
let M_WIND_TOWER: THREE.Material = standardMaterial(0xcdb9a0);
let M_WIND_BLADE: THREE.Material = standardMaterial(0x3a3a3a);
const M_BEACON_LIGHT: THREE.Material = standardMaterial(0xff5a3c); // emissive-ish warning light, no PBR set

/** Swaps every shared prop/building material for its loaded PBR version. One instance per kind
 * (rule: no per-instance material) — reassigning these bindings updates every mesh built after
 * this call; meshes already streamed in keep sharing the same object they were given. */
export function setPropMaterials(materials: PropMaterials): void {
  M_WALL = materials.wall;
  M_ROOF = materials.roof;
  materials.ramp.side = THREE.DoubleSide;
  M_RAMP = materials.ramp;
  M_BEACON = materials.beaconMetal;
  M_WIND_TOWER = materials.windmillTower;
  M_WIND_BLADE = materials.blade;
}

// ── Town buildings (unit cube scaled per building → bounded memory) ────
const G_UNIT = new THREE.BoxGeometry(1, 1, 1);

function building(b: W.BuildingBox, rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(G_UNIT, M_WALL[Math.floor(rng() * M_WALL.length)]);
  wall.scale.set(b.w, b.h, b.d);
  wall.position.y = b.h / 2;
  g.add(wall);
  const roofH = Math.max(0.4, b.h * 0.14);
  const roof = new THREE.Mesh(G_UNIT, M_ROOF);
  roof.scale.set(b.w * 1.08, roofH, b.d * 1.08);
  roof.position.y = b.h + roofH / 2 - 0.05;
  g.add(roof);
  return g;
}

// ── Stunt ramps (one shared unit wedge, scaled per ramp) ───────────────
const G_WEDGE = makeUnitWedge();

function makeUnitWedge(): THREE.BufferGeometry {
  // Unit wedge: x,z ∈ [-0.5,0.5], base y=0, rising to y=1 at the front (z=+0.5).
  const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [-0.5, 0, 0.5];
  const D = [0.5, 0, 0.5], E = [-0.5, 1, 0.5], F = [0.5, 1, 0.5];
  const tris = [
    A, C, D, A, D, B,   // bottom
    A, B, F, A, F, E,   // slope (drive surface)
    C, D, F, C, F, E,   // front vertical
    A, C, E,            // left end
    B, D, F,            // right end
  ];
  const pos = new Float32Array(tris.flat());
  const uv = new Float32Array(tris.length * 2);
  for (let vertex = 0; vertex < tris.length; vertex++) {
    uv[vertex * 2] = tris[vertex][0] + 0.5;
    uv[vertex * 2 + 1] = tris[vertex][2] + 0.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

function ramp(r: W.Ramp): THREE.Object3D {
  const m = new THREE.Mesh(G_WEDGE, M_RAMP);
  m.scale.set(r.width, r.rise, r.len);
  return m;
}

// ── Landmarks ──────────────────────────────────────────────────────────
function beacon(): THREE.Object3D {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.7, 14, 6), M_BEACON);
  tower.position.y = 7;
  g.add(tower);
  const light = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), M_BEACON_LIGHT);
  light.position.y = 14.6;
  g.add(light);
  return g;
}

function windmill(): THREE.Object3D {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 10, 6), M_WIND_TOWER);
  tower.position.y = 5;
  g.add(tower);
  const hub = new THREE.Group();
  hub.position.y = 9.6;
  hub.position.z = 0.4;
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.5, 0.18), M_WIND_BLADE);
    blade.position.y = 2.6;
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI) / 2;
    pivot.add(blade);
    hub.add(pivot);
  }
  g.add(hub);
  return g;
}

function landmark(l: W.Landmark): THREE.Object3D {
  return l.kind === 'beacon' ? beacon() : windmill();
}

type Random = () => number;

const between = (rng: Random, min: number, max: number): number => min + rng() * (max - min);
const anyBoulder = (rng: Random): PolyPropId => BOULDER_IDS[Math.floor(rng() * BOULDER_IDS.length)];

/** Which Poly Haven prop grows on a cover, or null for bare ground. No cacti: the photo desert has none. */
function pick(cover: Cover, rng: Random): PolyPropId | null {
  const roll = rng();
  switch (cover) {
    case 'forest':
    case 'grass': return roll < 0.45 ? 'wild_rooibos_bush' : roll < 0.6 ? 'dead_tree_trunk_02' : null;
    case 'dirt':
    case 'dryGrass': return roll < 0.3 ? 'wild_rooibos_bush' : roll < 0.4 ? anyBoulder(rng) : roll < 0.5 ? 'namaqualand_stones_01' : null;
    case 'sand': return roll < 0.1 ? anyBoulder(rng) : roll < 0.17 ? 'wild_rooibos_bush' : roll < 0.2 ? 'dead_tree_trunk_02' : roll < 0.24 ? 'namaqualand_stones_01' : null;
    case 'rock':
    case 'gravel': return roll < 0.5 ? anyBoulder(rng) : null;
    case 'snow': return roll < 0.15 ? anyBoulder(rng) : null;
    default: return null; // water / mud / beach / road
  }
}

// The prototype's scatter scale range, and the bigger boulders it lined its long straight with.
const PROP_SCALE = { min: 0.8, max: 1.7 };
// The HDRI hills are heaps of these same boulders, so the border is heaped with them too: loose
// ones at the foot, big ones over the face and the crest, which form the skyline.
const CLIFF_FOOT = { from: 0.5, to: 4, scaleMin: 2.5, scaleMax: 5 };
const CLIFF_FACE = { from: 4, to: 22, scaleMin: 3, scaleMax: 7 };
const CLIFF_ATTEMPTS = 120;
const EXTRA_ATTEMPTS = 10;
// Sinks a boulder's flat base into a slope so no edge of it hangs in the air.
const SLOPE_SINK = 0.25;

/** Beyond these distances a prop is a few pixels in the fog; hiding it saves most of the draw
 * calls, since every bush is fifteen meshes. Border boulders are the skyline and always drawn. */
const DRAW_DISTANCE: Record<PolyPropId, number> = {
  namaqualand_boulder_02: 260,
  namaqualand_boulder_03: 260,
  namaqualand_boulder_05: 260,
  dead_tree_trunk_02: 200,
  wild_rooibos_bush: 140,
  namaqualand_stones_01: 90,
};

interface DistanceCulledProp {
  object: THREE.Object3D;
  maxDistance: number;
}

const culledProps = new Set<DistanceCulledProp>();

/** Shows each scattered prop only inside its kind's draw distance from the camera. */
export function updatePropVisibility(cameraX: number, cameraZ: number): void {
  for (const prop of culledProps) {
    const distance = Math.hypot(prop.object.position.x - cameraX, prop.object.position.z - cameraZ);
    prop.object.visible = distance < prop.maxDistance;
  }
}

const highTierGroups = new Set<THREE.Group>();
let highTierVisible = true;

/** Shows or hides the non-solid props only the high tier draws, in every loaded chunk. */
export function setHighTierPropsVisible(visible: boolean): void {
  highTierVisible = visible;
  for (const group of highTierGroups) group.visible = visible;
}

export function releaseChunkScatter(scatter: ChunkScatter): void {
  highTierGroups.delete(scatter.highTier);
  for (const prop of scatter.culled) culledProps.delete(prop);
}

/** Margin added to the lake's own footprint (radius + feather) before a prop may be placed — the
 * lake bed and its wet shore must stay loop-able, per the spec's "nothing placed inside the
 * lake's footprint". */
const LAKE_PROP_MARGIN = 2;

/** Whether a natural prop may be placed at (x, z) — false inside the lake's footprint plus margin. */
export function isPropAllowedAt(x: number, z: number): boolean {
  return W.lakeDist(x, z) >= W.LAKE.radius + W.LAKE.feather + LAKE_PROP_MARGIN;
}

/** Deterministic Poly Haven props + authored features scattered across one chunk. */
export interface ChunkScatter {
  group: THREE.Group;
  /** Child of `group` holding the props only the high tier draws. */
  highTier: THREE.Group;
  knockables: THREE.Object3D[]; // bushes that fold over when the car ploughs through
  solids: SolidProp[];
  culled: DistanceCulledProp[];
}

function keepsClear(x: number, z: number, feats: W.ChunkFeatures): boolean {
  const road = W.nearestRoad(x, z);
  if (road && road.dist < W.ROAD_HALF + W.ROAD_SHOULDER + 2) return true;
  if (W.townDist(x, z) < W.TOWN.plaza + 4) return true;
  if (W.spawnDist(x, z) < W.SPAWN_KNOLL.top) return true;
  if (W.inSaltFlat(x, z)) return true;
  if (!isPropAllowedAt(x, z)) return true;
  return feats.ramps.some((r) => Math.hypot(x - r.x, z - r.z) < r.len + 6);
}

export function createChunkScatter(
  cx: number,
  cz: number,
  seed: number,
  height: Height2D,
  biome: Biome,
): ChunkScatter {
  const g = new THREE.Group();
  const highTier = new THREE.Group();
  highTier.visible = highTierVisible;
  g.add(highTier);
  highTierGroups.add(highTier);
  const knockables: THREE.Object3D[] = [];
  const solids: SolidProp[] = [];
  const culled: DistanceCulledProp[] = [];
  const rng = mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ seed) >>> 0);
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const COUNT = 14;
  const feats = W.featuresInChunk(cx, cz);

  const add = (
    id: PolyPropId, x: number, groundY: number, z: number, scale: number, parent: THREE.Group, rotation: number, skyline = false,
  ): void => {
    const placed = placePolyProp(id, x, groundY, z, rotation, scale);
    parent.add(placed.object);
    if (!skyline) {
      const prop = { object: placed.object, maxDistance: DRAW_DISTANCE[id] };
      culled.push(prop);
      culledProps.add(prop);
    }
    if (placed.solid) solids.push(placed.solid);
    if (id === 'wild_rooibos_bush') knockables.push(placed.object);
  };

  for (let i = 0; i < COUNT; i++) {
    const x = ox + rng() * CHUNK_SIZE;
    const z = oz + rng() * CHUNK_SIZE;
    // Keep roads, town plaza, salt flats, the stunt ramps and the lake clear of natural props.
    // The border slope is dressed by its own loop below.
    if (keepsClear(x, z, feats) || W.borderDepth(x, z) > 0) continue;
    const { height: h, slope } = surfaceSampleAt(height, x, z);
    const id = pick(biome.coverAt(x, z, h, slope), rng);
    if (!id) continue;
    add(id, x, h, z, between(rng, PROP_SCALE.min, PROP_SCALE.max), g, rng() * Math.PI * 2);
  }

  // Boulders heaped along the border slope break up its long even face and skyline.
  const cliffRng = mulberry32(((cx * 83492791) ^ (cz * 2971215073) ^ seed ^ 0xc11f) >>> 0);
  for (let i = 0; i < CLIFF_ATTEMPTS; i++) {
    const x = ox + cliffRng() * CHUNK_SIZE;
    const z = oz + cliffRng() * CHUNK_SIZE;
    const outside = W.borderDepth(x, z);
    const band = outside >= CLIFF_FOOT.from && outside <= CLIFF_FOOT.to ? CLIFF_FOOT
      : outside > CLIFF_FACE.from && outside <= CLIFF_FACE.to ? CLIFF_FACE : null;
    if (!band || keepsClear(x, z, feats)) continue;
    const scale = between(cliffRng, band.scaleMin, band.scaleMax);
    const groundY = visualTerrainHeight(terrainSurfaceHeight(height, x, z), x, z) - SLOPE_SINK * scale;
    add(anyBoulder(cliffRng), x, groundY, z, scale, g, cliffRng() * Math.PI * 2, band === CLIFF_FACE);
  }

  // The prototype's high tier adds a second, denser layer; here only bushes and stones, so the
  // tiers never disagree about what the car can hit.
  const extraRng = mulberry32(((cx * 19990303) ^ (cz * 83492791) ^ seed ^ 0xe7a) >>> 0);
  for (let i = 0; i < EXTRA_ATTEMPTS; i++) {
    const x = ox + extraRng() * CHUNK_SIZE;
    const z = oz + extraRng() * CHUNK_SIZE;
    if (keepsClear(x, z, feats) || W.borderDepth(x, z) > 0) continue;
    const { height: h, slope } = surfaceSampleAt(height, x, z);
    const cover = biome.coverAt(x, z, h, slope);
    if (cover !== 'sand' && cover !== 'dirt' && cover !== 'dryGrass') continue;
    const id: PolyPropId = extraRng() < 0.6 ? 'wild_rooibos_bush' : 'namaqualand_stones_01';
    add(id, x, h, z, between(extraRng, PROP_SCALE.min, PROP_SCALE.max), highTier, extraRng() * Math.PI * 2);
  }

  // Authored features (drawn here; collided as solids by the physics path). NOT knockable.
  const brng = mulberry32(((cx * 668265263) ^ (cz * 374761393) ^ seed ^ 0xb1d6) >>> 0);
  const place = (obj: THREE.Object3D, x: number, z: number, yaw: number) => {
    obj.position.set(x, terrainSurfaceHeight(height, x, z), z);
    obj.rotation.y = yaw;
    obj.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    g.add(obj);
  };
  for (const b of feats.buildings) place(building(b, brng), b.x, b.z, b.yaw);
  for (const r of feats.ramps) place(ramp(r), r.x, r.z, r.yaw);
  for (const l of feats.landmarks) place(landmark(l), l.x, l.z, l.yaw);

  return { group: g, highTier, knockables, solids, culled };
}
