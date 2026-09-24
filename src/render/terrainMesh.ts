// src/render/terrainMesh.ts
import * as THREE from 'three';
import { buildChunkGeometry } from '../world/chunkGeometry';
import type { Biome } from '../world/biome';

// White base so per-vertex colours show through under normal PBR shading (real terrain textures
// replace the flat per-triangle colour in a later task).
const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
terrainMaterial.vertexColors = true;

const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const fn = new THREE.Vector3();

/**
 * Build a chunk render mesh from its row-major height grid. Each triangle gets a single FLAT
 * coverage colour (from the biome, classified at the triangle centroid + its face slope) so
 * coverage boundaries are crisp instead of a smeared vertex gradient — while vertex normals stay
 * smooth, so the dunes are still smoothly lit. Vertices match the physics collider geometry.
 */
export function buildTerrainMesh(
  heights: Float32Array,
  originX: number,
  originZ: number,
  biome: Biome,
): THREE.Mesh {
  const { positions, indices } = buildChunkGeometry(heights, originX, originZ);

  // Smooth per-vertex normals from the indexed grid.
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  indexed.setIndex(Array.from(indices));
  indexed.computeVertexNormals();
  const normalAttribute = indexed.attributes.normal;
  const inorm = new Float32Array(normalAttribute.count * 3);
  for (let vertex = 0; vertex < normalAttribute.count; vertex++) {
    inorm[vertex * 3] = normalAttribute.getX(vertex);
    inorm[vertex * 3 + 1] = normalAttribute.getY(vertex);
    inorm[vertex * 3 + 2] = normalAttribute.getZ(vertex);
  }

  const triCount = indices.length / 3;
  const pos = new Float32Array(triCount * 9);
  const nor = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  const c = new THREE.Color();

  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const d = indices[t * 3 + 2];
    const ai = a * 3;
    const bi = b * 3;
    const di = d * 3;

    // copy the 3 vertex positions + smooth normals (de-indexed)
    const tv = [ai, bi, di];
    for (let k = 0; k < 3; k++) {
      const s = tv[k];
      const o = t * 9 + k * 3;
      pos[o] = positions[s];
      pos[o + 1] = positions[s + 1];
      pos[o + 2] = positions[s + 2];
      nor[o] = inorm[s];
      nor[o + 1] = inorm[s + 1];
      nor[o + 2] = inorm[s + 2];
    }

    // centroid + face slope for biome classification
    const cx = (positions[ai] + positions[bi] + positions[di]) / 3;
    const cy = (positions[ai + 1] + positions[bi + 1] + positions[di + 1]) / 3;
    const cz = (positions[ai + 2] + positions[bi + 2] + positions[di + 2]) / 3;
    e1.set(positions[bi] - positions[ai], positions[bi + 1] - positions[ai + 1], positions[bi + 2] - positions[ai + 2]);
    e2.set(positions[di] - positions[ai], positions[di + 1] - positions[ai + 1], positions[di + 2] - positions[ai + 2]);
    fn.crossVectors(e1, e2).normalize();
    const slope = Math.hypot(fn.x, fn.z) / Math.max(Math.abs(fn.y), 1e-4);

    c.set(biome.colorAt(cx, cy, cz, slope));
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
    }
  }
  indexed.dispose();

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const mesh = new THREE.Mesh(geom, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
