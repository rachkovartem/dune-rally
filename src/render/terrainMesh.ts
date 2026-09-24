// src/render/terrainMesh.ts
import * as THREE from 'three';
import { buildChunkGeometry } from '../world/chunkGeometry';
import type { Biome, Cover } from '../world/biome';
import { COVER } from '../world/biome';
import { textureSetForCover } from '../assets/textureManifest';
import { layerIndexFor } from './terrainTextures';

// Fallback while the PBR material's textures are still loading (setTerrainMaterial swaps this
// out once buildArrayTexture finishes) — plain white so vertex-driven shading doesn't clash once
// the swap happens, matching the look of an unlit chunk for the first frame or two only.
let terrainMaterial: THREE.Material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });

/** Swaps the shared terrain material once its textures are ready. One instance for every chunk
 * (rule: no per-chunk material) — chunks built after the swap pick it up immediately; chunks
 * already in the scene keep it too, since they share the very same material object. */
export function setTerrainMaterial(material: THREE.Material): void {
  terrainMaterial = material;
}

const TINT_BY_COVER: Record<Cover, THREE.Color> = Object.fromEntries(
  (Object.keys(COVER) as Cover[]).map((cover) => [cover, new THREE.Color(COVER[cover])]),
) as Record<Cover, THREE.Color>;

export interface CoverPair {
  a: Cover;
  b: Cover;
  weight: number; // 0 = fully `a`, 1 = fully `b`
}

/** Reduces the covers seen at a triangle's vertices to the two dominant ones and a blend weight —
 * uniform input gives weight 0 (no blend), an even split between two covers gives weight ≈ 0.5. */
export function chooseCoverPair(covers: readonly Cover[]): CoverPair {
  if (covers.length === 0) throw new Error('chooseCoverPair: at least one cover is required.');
  const counts = new Map<Cover, number>();
  for (const cover of covers) counts.set(cover, (counts.get(cover) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((first, second) => second[1] - first[1]);
  const [a, countA] = ranked[0];
  const second = ranked[1];
  if (!second) return { a, b: a, weight: 0 };
  const [b, countB] = second;
  return { a, b, weight: countB / (countA + countB) };
}

/**
 * Build a chunk render mesh from its row-major height grid. Cover is classified per VERTEX (from
 * the smooth vertex normal's slope, not the flat face normal) so a triangle can blend between up
 * to two covers instead of showing one hard-edged colour — soft transitions across cover
 * boundaries (dune sand into gravel, road shoulder into open desert). Vertices match the physics
 * collider geometry.
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
  const vertexCount = normalAttribute.count;
  const inorm = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    inorm[vertex * 3] = normalAttribute.getX(vertex);
    inorm[vertex * 3 + 1] = normalAttribute.getY(vertex);
    inorm[vertex * 3 + 2] = normalAttribute.getZ(vertex);
  }

  // Classify every vertex once (position + smooth-normal slope), reused by every triangle sharing it.
  const vertexCover: Cover[] = new Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const nx = inorm[vertex * 3];
    const ny = inorm[vertex * 3 + 1];
    const nz = inorm[vertex * 3 + 2];
    const slope = Math.hypot(nx, nz) / Math.max(Math.abs(ny), 1e-4);
    vertexCover[vertex] = biome.coverAt(x, z, y, slope);
  }

  const triCount = indices.length / 3;
  const pos = new Float32Array(triCount * 9);
  const nor = new Float32Array(triCount * 9);
  const coverAAttr = new Float32Array(triCount * 3);
  const coverBAttr = new Float32Array(triCount * 3);
  const coverWeightAttr = new Float32Array(triCount * 3);
  const tintAAttr = new Float32Array(triCount * 9);
  const tintBAttr = new Float32Array(triCount * 9);

  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const d = indices[t * 3 + 2];
    const tv = [a, b, d];

    for (let k = 0; k < 3; k++) {
      const s = tv[k] * 3;
      const o = t * 9 + k * 3;
      pos[o] = positions[s];
      pos[o + 1] = positions[s + 1];
      pos[o + 2] = positions[s + 2];
      nor[o] = inorm[s];
      nor[o + 1] = inorm[s + 1];
      nor[o + 2] = inorm[s + 2];
    }

    const pair = chooseCoverPair([vertexCover[a], vertexCover[b], vertexCover[d]]);
    const layerA = layerIndexFor(textureSetForCover(pair.a));
    const layerB = layerIndexFor(textureSetForCover(pair.b));
    const tintA = TINT_BY_COVER[pair.a];
    const tintB = TINT_BY_COVER[pair.b];

    for (let k = 0; k < 3; k++) {
      coverAAttr[t * 3 + k] = layerA;
      coverBAttr[t * 3 + k] = layerB;
      coverWeightAttr[t * 3 + k] = pair.weight;
      const to = t * 9 + k * 3;
      tintAAttr[to] = tintA.r; tintAAttr[to + 1] = tintA.g; tintAAttr[to + 2] = tintA.b;
      tintBAttr[to] = tintB.r; tintBAttr[to + 1] = tintB.g; tintBAttr[to + 2] = tintB.b;
    }
  }
  indexed.dispose();

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geom.setAttribute('coverA', new THREE.BufferAttribute(coverAAttr, 1));
  geom.setAttribute('coverB', new THREE.BufferAttribute(coverBAttr, 1));
  geom.setAttribute('coverWeight', new THREE.BufferAttribute(coverWeightAttr, 1));
  geom.setAttribute('tintA', new THREE.BufferAttribute(tintAAttr, 3));
  geom.setAttribute('tintB', new THREE.BufferAttribute(tintBAttr, 3));

  const mesh = new THREE.Mesh(geom, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
