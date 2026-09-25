// src/render/scatter.ts
import * as THREE from 'three';
import { mulberry32 } from '../world/rng';
import { terrainSurfaceHeight } from '../world/chunkGeometry';
import * as W from '../world/worldDef';
import type { Height2D } from '../world/noise';
import type { Biome } from '../world/biome';
import type { PolyPropId } from '../world/propIds';
import { propPlacementsInChunk, type PropPlacement } from '../world/propPlacement';
import type { PropMaterials } from './propMaterials';
import { placePolyProp } from './polyProps';
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

/** Beyond these distances a prop is a few pixels in the fog; hiding it saves most of the draw
 * calls, since every bush is fifteen meshes. Skyline props (the border face, the koppie heaps) are always drawn. */
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

/** Props that never move keep the world matrix they were placed with, so the per-frame scene update skips them. */
function freezeInPlace(object: THREE.Object3D): void {
  object.updateMatrixWorld(true);
  object.traverse((node) => { node.matrixAutoUpdate = false; });
}

export function releaseChunkScatter(scatter: ChunkScatter): void {
  highTierGroups.delete(scatter.highTier);
  for (const prop of scatter.culled) culledProps.delete(prop);
}

/** Deterministic Poly Haven props + authored features scattered across one chunk. */
export interface ChunkScatter {
  group: THREE.Group;
  /** Child of `group` holding the props only the high tier draws. */
  highTier: THREE.Group;
  knockables: THREE.Object3D[]; // bushes that fold over when the car ploughs through
  /** Every placement drawn here; the physics hook builds the colliders of the solid ones from the same list. */
  placements: readonly PropPlacement[];
  culled: DistanceCulledProp[];
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
  g.matrixAutoUpdate = false;
  highTier.matrixAutoUpdate = false;
  highTierGroups.add(highTier);
  const knockables: THREE.Object3D[] = [];
  const culled: DistanceCulledProp[] = [];
  const feats = W.featuresInChunk(cx, cz);

  const add = (placement: PropPlacement): void => {
    const object = placePolyProp(placement);
    (placement.layer === 'highTier' ? highTier : g).add(object);
    if (!placement.skyline) {
      const prop = { object, maxDistance: DRAW_DISTANCE[placement.modelId] };
      culled.push(prop);
      culledProps.add(prop);
    }
    if (placement.knockable) knockables.push(object);
    else freezeInPlace(object);
  };

  const placements = propPlacementsInChunk({ cx, cz, seed, height, biome, drawnHeight: visualTerrainHeight });
  for (const placement of placements) add(placement);

  // Authored features (drawn here; collided as solids by the physics path). NOT knockable.
  const brng = mulberry32(((cx * 668265263) ^ (cz * 374761393) ^ seed ^ 0xb1d6) >>> 0);
  const place = (obj: THREE.Object3D, x: number, z: number, yaw: number) => {
    obj.position.set(x, terrainSurfaceHeight(height, x, z), z);
    obj.rotation.y = yaw;
    obj.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    g.add(obj);
    freezeInPlace(obj);
  };
  for (const b of feats.buildings) place(building(b, brng), b.x, b.z, b.yaw);
  for (const l of feats.landmarks) place(landmark(l), l.x, l.z, l.yaw);

  return { group: g, highTier, knockables, placements, culled };
}
