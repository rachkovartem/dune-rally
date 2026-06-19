// src/render/scatter.ts
import * as THREE from 'three';
import { mulberry32 } from '../world/rng';
import { CHUNK_SIZE } from '../world/chunk';
import { terrainSurfaceHeight } from '../world/chunkGeometry';
import type { Height2D } from '../world/noise';
import type { Biome, Cover } from '../world/biome';
import { makeToonMaterial } from './celShading';

// Shared materials + geometries (reused across all instances to keep memory/draw cost down).
const M_ROCK = makeToonMaterial(0x77756d);
const M_TRUNK = makeToonMaterial(0x5a3d22);
const M_LEAF = makeToonMaterial(0x3c6a2e);
const M_BUSH = makeToonMaterial(0x4f7a32);
const M_CACTUS = makeToonMaterial(0x4a7a40);

const G_ROCK = new THREE.IcosahedronGeometry(0.6, 0);
const G_TRUNK = new THREE.CylinderGeometry(0.16, 0.22, 1.4, 6);
const G_CONE = new THREE.ConeGeometry(1.0, 1.8, 7);
const G_BUSH = new THREE.IcosahedronGeometry(0.6, 0);
const G_CACTUS = new THREE.CylinderGeometry(0.28, 0.32, 1.7, 7);
const G_ARM = new THREE.BoxGeometry(0.22, 0.7, 0.22);

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

/** Deterministic low-poly props scattered across one chunk, placed by coverage type. */
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
  const COUNT = 16;
  const d = 1.5;

  for (let i = 0; i < COUNT; i++) {
    const x = ox + rng() * CHUNK_SIZE;
    const z = oz + rng() * CHUNK_SIZE;
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
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    g.add(obj);
    if (obj.userData.knockable) knockables.push(obj);
  }
  return { group: g, knockables };
}
