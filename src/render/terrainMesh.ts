// src/render/terrainMesh.ts
import * as THREE from 'three';
import { buildChunkGeometry } from '../world/chunkGeometry';
import { makeToonMaterial } from './celShading';

// White base so per-vertex colours show through; toon shading + vertex colour gives banded sand.
const terrainMaterial = makeToonMaterial(0xffffff);
terrainMaterial.vertexColors = true;
// Ink outlines suit discrete objects (the buggy); on the continuous terrain mesh the
// OutlineEffect's inverted-hull pass floods the surface. Opt the terrain out of outlining.
terrainMaterial.userData.outlineParameters = { visible: false };

const LOW = new THREE.Color(0x6e3d22); // canyon floor — dark earth
const MID = new THREE.Color(0xd9a455); // sand dunes
const HIGH = new THREE.Color(0xe9d6a8); // sunlit ridges
const H_MIN = -54.5;
const H_MAX = 36.5;

/**
 * Build a chunk render mesh from its row-major height grid. Vertices are world-space (shared
 * with the physics collider via buildChunkGeometry); per-vertex colour varies by height so the
 * desert reads as canyons/dunes/ridges rather than a flat slab.
 */
export function buildTerrainMesh(
  heights: Float32Array,
  originX: number,
  originZ: number,
): THREE.Mesh {
  const { positions, indices } = buildChunkGeometry(heights, originX, originZ);

  const colors = new Float32Array(positions.length);
  const c = new THREE.Color();
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    const t = Math.min(1, Math.max(0, (y - H_MIN) / (H_MAX - H_MIN)));
    if (t < 0.45) c.copy(LOW).lerp(MID, t / 0.45);
    else c.copy(MID).lerp(HIGH, (t - 0.45) / 0.55);
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.castShadow = true; // dunes self-shadow for depth
  return mesh;
}
