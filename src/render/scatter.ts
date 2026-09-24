// src/render/scatter.ts
import * as THREE from 'three';
import { mulberry32 } from '../world/rng';
import { CHUNK_SIZE } from '../world/chunk';
import { terrainSurfaceHeight } from '../world/chunkGeometry';
import * as W from '../world/worldDef';
import type { Height2D } from '../world/noise';
import type { Biome, Cover } from '../world/biome';

function standardMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
}

// Shared materials + geometries (reused across all instances to keep memory/draw cost down).
const M_ROCK = standardMaterial(0x77756d);
const M_TRUNK = standardMaterial(0x5a3d22);
const M_LEAF = standardMaterial(0x3c6a2e);
const M_BUSH = standardMaterial(0x4f7a32);
const M_CACTUS = standardMaterial(0x4a7a40);

const G_ROCK = new THREE.IcosahedronGeometry(0.6, 0);
const G_TRUNK = new THREE.CylinderGeometry(0.16, 0.22, 1.4, 6);
const G_CONE = new THREE.ConeGeometry(1.0, 1.8, 7);
const G_BUSH = new THREE.IcosahedronGeometry(0.6, 0);
const G_CACTUS = new THREE.CylinderGeometry(0.28, 0.32, 1.7, 7);
const G_ARM = new THREE.BoxGeometry(0.22, 0.7, 0.22);

// ── Town buildings (unit cube scaled per building → bounded memory) ────
const G_UNIT = new THREE.BoxGeometry(1, 1, 1);
const M_WALL = [
  standardMaterial(0xb89b72),
  standardMaterial(0xa67c52),
  standardMaterial(0xc9b489),
  standardMaterial(0x9c8466),
];
const M_ROOF = standardMaterial(0x6b4f3a);

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
const M_RAMP = (() => { const m = standardMaterial(0xb05a2e); m.side = THREE.DoubleSide; return m; })();

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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function ramp(r: W.Ramp): THREE.Object3D {
  const m = new THREE.Mesh(G_WEDGE, M_RAMP);
  m.scale.set(r.width, r.rise, r.len);
  return m;
}

// ── Landmarks ──────────────────────────────────────────────────────────
const M_BEACON = standardMaterial(0xb6bcc4);
const M_BEACON_LIGHT = standardMaterial(0xff5a3c);
const M_WIND_TOWER = standardMaterial(0xcdb9a0);
const M_WIND_BLADE = standardMaterial(0x3a3a3a);

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

function rock(rng: () => number): THREE.Object3D {
  const m = new THREE.Mesh(G_ROCK, M_ROCK);
  const s = 0.5 + rng() * 1.3;
  m.scale.set(s, s * (0.6 + rng() * 0.5), s);
  m.position.y = 0.1 * s;
  return m;
}

function tree(rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(G_TRUNK, M_TRUNK);
  trunk.position.y = 0.7;
  g.add(trunk);
  const tiers = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < tiers; i++) {
    const cone = new THREE.Mesh(G_CONE, M_LEAF);
    const k = 1 - i * 0.22;
    cone.scale.set(k, k, k);
    cone.position.y = 1.5 + i * 1.0;
    g.add(cone);
  }
  const s = 0.8 + rng() * 0.6;
  g.scale.setScalar(s);
  g.userData.knockable = true;
  return g;
}

function bush(rng: () => number): THREE.Object3D {
  const m = new THREE.Mesh(G_BUSH, M_BUSH);
  const s = 0.6 + rng() * 0.7;
  m.scale.set(s, s * 0.7, s);
  m.position.y = 0.35 * s;
  return m;
}

function cactus(rng: () => number): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(G_CACTUS, M_CACTUS);
  body.position.y = 0.85;
  g.add(body);
  if (rng() < 0.7) {
    const arm = new THREE.Mesh(G_ARM, M_CACTUS);
    const side = rng() < 0.5 ? -1 : 1;
    arm.position.set(side * 0.35, 1.0, 0);
    g.add(arm);
  }
  g.scale.setScalar(0.8 + rng() * 0.5);
  g.userData.knockable = true;
  return g;
}

function pick(cover: Cover, rng: () => number): THREE.Object3D | null {
  switch (cover) {
    case 'forest': return rng() < 0.75 ? tree(rng) : bush(rng);
    case 'grass': return rng() < 0.35 ? tree(rng) : rng() < 0.8 ? bush(rng) : null;
    case 'dirt':
    case 'dryGrass': return rng() < 0.3 ? bush(rng) : rng() < 0.5 ? rock(rng) : null;
    case 'sand': return rng() < 0.16 ? cactus(rng) : rng() < 0.24 ? rock(rng) : null;
    case 'rock':
    case 'gravel': return rng() < 0.5 ? rock(rng) : null;
    case 'snow': return rng() < 0.15 ? rock(rng) : null;
    default: return null; // water / mud / beach / road
  }
}

/** Deterministic low-poly props + authored features scattered across one chunk. */
export interface ChunkScatter {
  group: THREE.Group;
  knockables: THREE.Object3D[]; // trees & cacti that can be knocked over
}

export function createChunkScatter(
  cx: number,
  cz: number,
  seed: number,
  height: Height2D,
  biome: Biome,
): ChunkScatter {
  const g = new THREE.Group();
  const knockables: THREE.Object3D[] = [];
  const rng = mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ seed) >>> 0);
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const COUNT = 14;
  const d = 1.5;
  const feats = W.featuresInChunk(cx, cz);

  for (let i = 0; i < COUNT; i++) {
    const x = ox + rng() * CHUNK_SIZE;
    const z = oz + rng() * CHUNK_SIZE;
    // Keep roads, town plaza, salt flats and the stunt ramps clear of natural props.
    const rd = W.nearestRoad(x, z);
    if (rd && rd.dist < W.ROAD_HALF + W.ROAD_SHOULDER + 2) continue;
    if (W.townDist(x, z) < W.TOWN.plaza + 4) continue;
    if (W.inSaltFlat(x, z)) continue;
    if (feats.ramps.some((r) => Math.hypot(x - r.x, z - r.z) < r.len + 6)) continue;
    const h = terrainSurfaceHeight(height, x, z);
    const slope =
      Math.hypot(
        terrainSurfaceHeight(height, x + d, z) - terrainSurfaceHeight(height, x - d, z),
        terrainSurfaceHeight(height, x, z + d) - terrainSurfaceHeight(height, x, z - d),
      ) / (2 * d);
    const obj = pick(biome.coverAt(x, z, h, slope), rng);
    if (!obj) continue;
    obj.position.set(x, h, z);
    obj.rotation.y = rng() * Math.PI * 2;
    obj.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    g.add(obj);
    if (obj.userData.knockable) knockables.push(obj);
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

  return { group: g, knockables };
}
