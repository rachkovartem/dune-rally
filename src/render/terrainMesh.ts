// src/render/terrainMesh.ts
import * as THREE from 'three';
import { buildChunkGeometry } from '../world/chunkGeometry';
import { VERTS_PER_SIDE } from '../world/heightfieldData';
import { CHUNK_SIZE, CHUNK_RES } from '../world/chunk';
import { makeToonMaterial } from './celShading';
import type { Biome } from '../world/biome';

// White base so per-vertex colours show through; toon shading + vertex colour gives banded ground.
const terrainMaterial = makeToonMaterial(0xffffff);
terrainMaterial.vertexColors = true;
// Ink outlines suit discrete objects (the buggy); on the continuous terrain mesh the
// OutlineEffect's inverted-hull pass floods the surface. Opt the terrain out of outlining.
terrainMaterial.userData.outlineParameters = { visible: false };

const STEP = CHUNK_SIZE / CHUNK_RES;

/**
 * Build a chunk render mesh from its row-major height grid. Vertices are world-space (shared
 * with the physics collider via buildChunkGeometry); per-vertex colour comes from the biome
 * classifier (height + slope + seeded moisture/road fields) → grass, sand, rock, snow, road, etc.
 */
export function buildTerrainMesh(
  heights: Float32Array,
  originX: number,
  originZ: number,
  biome: Biome,
): THREE.Mesh {
  const { positions, indices } = buildChunkGeometry(heights, originX, originZ);
  const n = VERTS_PER_SIDE;

  const colors = new Float32Array(positions.length);
  const c = new THREE.Color();
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const i = (r * n + col) * 3;
      // Local slope from grid neighbours (clamped at chunk edges).
      const cl = Math.max(0, col - 1);
      const cr = Math.min(n - 1, col + 1);
      const rl = Math.max(0, r - 1);
      const rr = Math.min(n - 1, r + 1);
      const dhdx = (heights[r * n + cr] - heights[r * n + cl]) / ((cr - cl) * STEP);
      const dhdz = (heights[rr * n + col] - heights[rl * n + col]) / ((rr - rl) * STEP);
      const slope = Math.hypot(dhdx, dhdz);

      const hex = biome.colorAt(positions[i], positions[i + 1], positions[i + 2], slope);
      c.set(hex);
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.castShadow = true; // terrain self-shadows for depth
  return mesh;
}
