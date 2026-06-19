// src/render/terrainMesh.ts
import * as THREE from 'three';
import { CHUNK_SIZE } from '../world/chunk';
import { VERTS_PER_SIDE } from '../world/heightfieldData';
import { makeToonMaterial } from './celShading';

const terrainMaterial = makeToonMaterial(0xc98a4b);

/** Build a chunk mesh. `heights` is row-major (row=z, col=x), length VERTS_PER_SIDE². */
export function buildTerrainMesh(
  heights: Float32Array,
  originX: number,
  originZ: number,
): THREE.Mesh {
  const n = VERTS_PER_SIDE;
  const step = CHUNK_SIZE / (n - 1);

  const positions = new Float32Array(n * n * 3);
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const i = r * n + col;
      positions[i * 3 + 0] = col * step;       // local X
      positions[i * 3 + 1] = heights[i];        // Y (up)
      positions[i * 3 + 2] = r * step;          // local Z
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < n - 1; r++) {
    for (let col = 0; col < n - 1; col++) {
      const a = r * n + col;
      const b = r * n + col + 1;
      const c = (r + 1) * n + col;
      const d = (r + 1) * n + col + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, terrainMaterial);
  mesh.position.set(originX, 0, originZ);
  return mesh;
}
