// src/render/terrainMesh.ts
import * as THREE from 'three';
import { buildChunkGeometry } from '../world/chunkGeometry';
import { makeToonMaterial } from './celShading';

const terrainMaterial = makeToonMaterial(0xc98a4b);
// Ink outlines suit discrete objects (the buggy); on the continuous, open terrain mesh the
// OutlineEffect's inverted-hull pass floods the surface. Opt the terrain out of outlining.
terrainMaterial.userData.outlineParameters = { visible: false };

/**
 * Build a chunk render mesh from its row-major height grid. The vertices are world-space
 * (shared with the physics collider via buildChunkGeometry), so the mesh sits at the origin.
 */
export function buildTerrainMesh(
  heights: Float32Array,
  originX: number,
  originZ: number,
): THREE.Mesh {
  const { positions, indices } = buildChunkGeometry(heights, originX, originZ);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();

  return new THREE.Mesh(geom, terrainMaterial);
}
