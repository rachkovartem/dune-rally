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
let M_BARK: THREE.Material = standardMaterial(0x4a3424);
let M_LEAF: THREE.Material = standardMaterial(0x2d5225);
let M_BUSH: THREE.Material = standardMaterial(0x3e6b2c);
let M_WOOD: THREE.Material = standardMaterial(0x8a6d48);
const M_WINDOW: THREE.Material = new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.2, metalness: 0.8 });

/** Swaps every shared prop/building material for its loaded PBR version. One instance per kind
 * (rule: no per-instance material) — reassigning these bindings updates every mesh built after
 * this call; meshes already streamed in keep sharing the same object they were given. */
export function setPropMaterials(materials: PropMaterials): void {
  M_WALL = materials.wall;
  M_ROOF = materials.roof;
  M_BEACON = materials.beaconMetal;
  M_WIND_TOWER = materials.windmillTower;
  M_WIND_BLADE = materials.blade;
  M_BARK = materials.bark;
  M_LEAF = materials.leaf;
  M_BUSH = materials.bush;
  M_WOOD = materials.wood ?? standardMaterial(0x8a6d48);
}

// ── Town buildings (realistic houses, porches, pitched roofs) ────
const G_UNIT = new THREE.BoxGeometry(1, 1, 1);

function building(b: W.BuildingBox, rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const wallMat = M_WALL[Math.floor(rng() * M_WALL.length)];
  const roofMat = b.roofKind === 'metal' ? M_BEACON : b.roofKind === 'planks' ? M_WOOD : M_ROOF;

  // 1. Main wall structure
  const wall = new THREE.Mesh(G_UNIT, wallMat);
  wall.scale.set(b.w, b.h, b.d);
  wall.position.y = b.h / 2;
  wall.castShadow = true;
  wall.receiveShadow = true;
  g.add(wall);

  // 2. Realistic pitched / gable roof with eaves overhang
  const roofHeight = Math.max(1.0, Math.min(2.4, b.w * 0.18));
  const halfSpan = b.w * 0.54;
  const slopeLen = Math.hypot(halfSpan, roofHeight);
  const pitchAngle = Math.atan2(roofHeight, halfSpan);

  // Left slope
  const leftSlope = new THREE.Mesh(G_UNIT, roofMat);
  leftSlope.scale.set(slopeLen, 0.12, b.d * 1.06);
  leftSlope.position.set(-halfSpan * 0.5, b.h + roofHeight * 0.5, 0);
  leftSlope.rotation.z = pitchAngle;
  leftSlope.castShadow = true;
  leftSlope.receiveShadow = true;
  g.add(leftSlope);

  // Right slope
  const rightSlope = new THREE.Mesh(G_UNIT, roofMat);
  rightSlope.scale.set(slopeLen, 0.12, b.d * 1.06);
  rightSlope.position.set(halfSpan * 0.5, b.h + roofHeight * 0.5, 0);
  rightSlope.rotation.z = -pitchAngle;
  rightSlope.castShadow = true;
  rightSlope.receiveShadow = true;
  g.add(rightSlope);

  // Gable end walls (closing the triangular ends under the roof)
  const gableFront = new THREE.Mesh(G_UNIT, wallMat);
  gableFront.scale.set(b.w * 0.98, roofHeight * 0.85, 0.1);
  gableFront.position.set(0, b.h + roofHeight * 0.42, b.d * 0.5);
  gableFront.castShadow = true;
  g.add(gableFront);

  const gableBack = new THREE.Mesh(G_UNIT, wallMat);
  gableBack.scale.set(b.w * 0.98, roofHeight * 0.85, 0.1);
  gableBack.position.set(0, b.h + roofHeight * 0.42, -b.d * 0.5);
  gableBack.castShadow = true;
  g.add(gableBack);

  // 3. Front Porch / Veranda (for houses with porches)
  if (b.hasPorch) {
    const porchDepth = 2.4;
    const porchWidth = b.w * 0.88;
    const porchH = Math.min(2.6, b.h * 0.48);

    // Porch floor deck
    const deck = new THREE.Mesh(G_UNIT, M_WOOD);
    deck.scale.set(porchWidth, 0.18, porchDepth);
    deck.position.set(0, 0.09, b.d / 2 + porchDepth / 2);
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);

    // Porch awning roof
    const awning = new THREE.Mesh(G_UNIT, roofMat);
    awning.scale.set(porchWidth * 1.04, 0.1, porchDepth * 1.05);
    awning.position.set(0, porchH, b.d / 2 + porchDepth / 2);
    awning.rotation.x = 0.06; // slight forward drainage tilt
    awning.castShadow = true;
    awning.receiveShadow = true;
    g.add(awning);

    // Wooden support posts
    const postCount = 3;
    for (let p = 0; p < postCount; p++) {
      const px = -porchWidth / 2 + (porchWidth / (postCount - 1)) * p;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, porchH, 6), M_WOOD);
      post.position.set(px, porchH / 2, b.d / 2 + porchDepth - 0.1);
      post.castShadow = true;
      g.add(post);
    }
  }

  // 4. Entrance door on front facade
  const door = new THREE.Mesh(G_UNIT, M_WOOD);
  door.scale.set(1.4, 2.2, 0.1);
  door.position.set(0, 1.1, b.d / 2 + 0.05);
  door.castShadow = true;
  g.add(door);

  // 5. Windows
  const windowCount = Math.max(2, Math.floor(b.w / 4));
  for (let w = 0; w < windowCount; w++) {
    const wx = -b.w * 0.38 + (b.w * 0.76 / (windowCount - 1)) * w;
    if (Math.abs(wx) < 1.0) continue; // don't overlap door
    // Ground floor window
    const win = new THREE.Mesh(G_UNIT, M_WINDOW);
    win.scale.set(1.1, 1.3, 0.08);
    win.position.set(wx, 1.4, b.d / 2 + 0.05);
    g.add(win);

    // Second story windows if applicable
    if (b.stories === 2 && b.h > 5.5) {
      const win2 = new THREE.Mesh(G_UNIT, M_WINDOW);
      win2.scale.set(1.1, 1.3, 0.08);
      win2.position.set(wx, b.h * 0.7, b.d / 2 + 0.05);
      g.add(win2);
    }
  }

  // 6. Chimney on tile roofs
  if (b.roofKind !== 'metal' && rng() < 0.7) {
    const chimney = new THREE.Mesh(G_UNIT, M_WALL[0]);
    chimney.scale.set(0.7, 1.6, 0.7);
    chimney.position.set(b.w * 0.28, b.h + roofHeight * 0.6, 0);
    chimney.castShadow = true;
    g.add(chimney);
  }

  return g;
}

// ── Forest Trees (Pine & Broadleaf) ──────────────────────────────────
function treeMesh(t: W.TreeFeature): THREE.Object3D {
  const g = new THREE.Group();
  const trunkH = t.height * 0.55;

  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(t.trunkRadius * 0.65, t.trunkRadius, trunkH, 7);
  const trunk = new THREE.Mesh(trunkGeo, M_BARK);
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);

  // Canopy
  if (t.kind === 'pine') {
    // 3 conifer cone tiers
    const t1 = new THREE.Mesh(new THREE.ConeGeometry(t.trunkRadius * 4.2, t.height * 0.38, 7), M_LEAF);
    t1.position.y = t.height * 0.46;
    t1.castShadow = true;
    t1.receiveShadow = true;
    g.add(t1);

    const t2 = new THREE.Mesh(new THREE.ConeGeometry(t.trunkRadius * 3.2, t.height * 0.34, 7), M_LEAF);
    t2.position.y = t.height * 0.64;
    t2.castShadow = true;
    t2.receiveShadow = true;
    g.add(t2);

    const t3 = new THREE.Mesh(new THREE.ConeGeometry(t.trunkRadius * 2.0, t.height * 0.30, 7), M_LEAF);
    t3.position.y = t.height * 0.82;
    t3.castShadow = true;
    t3.receiveShadow = true;
    g.add(t3);
  } else {
    // Broadleaf clustered organic crown
    const mainPuff = new THREE.Mesh(new THREE.DodecahedronGeometry(t.trunkRadius * 3.4, 0), M_BUSH);
    mainPuff.position.y = t.height * 0.72;
    mainPuff.castShadow = true;
    mainPuff.receiveShadow = true;
    g.add(mainPuff);

    const puffLeft = new THREE.Mesh(new THREE.DodecahedronGeometry(t.trunkRadius * 2.5, 0), M_BUSH);
    puffLeft.position.set(-t.trunkRadius * 1.5, t.height * 0.65, 0.2);
    puffLeft.castShadow = true;
    puffLeft.receiveShadow = true;
    g.add(puffLeft);

    const puffRight = new THREE.Mesh(new THREE.DodecahedronGeometry(t.trunkRadius * 2.5, 0), M_BUSH);
    puffRight.position.set(t.trunkRadius * 1.5, t.height * 0.68, -0.2);
    puffRight.castShadow = true;
    puffRight.receiveShadow = true;
    g.add(puffRight);

    const puffTop = new THREE.Mesh(new THREE.DodecahedronGeometry(t.trunkRadius * 2.2, 0), M_BUSH);
    puffTop.position.set(0, t.height * 0.88, 0);
    puffTop.castShadow = true;
    puffTop.receiveShadow = true;
    g.add(puffTop);
  }

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
  for (const b of feats.buildings) {
    if (b.customRender) continue;
    place(building(b, brng), b.x, b.z, b.yaw);
  }
  for (const l of feats.landmarks) place(landmark(l), l.x, l.z, l.yaw);
  if (feats.trees) {
    for (const t of feats.trees) {
      const obj = treeMesh(t);
      obj.position.set(t.x, terrainSurfaceHeight(height, t.x, t.z), t.z);
      obj.rotation.y = t.yaw;
      g.add(obj);
      if (t.knockable) {
        knockables.push(obj);
      } else {
        freezeInPlace(obj);
      }
      const prop = { object: obj, maxDistance: 350 };
      culled.push(prop);
      culledProps.add(prop);
    }
  }

  return { group: g, highTier, knockables, placements, culled };
}
