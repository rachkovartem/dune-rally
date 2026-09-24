// src/render/terrainMesh.ts
import * as THREE from 'three';
import { buildChunkGeometry } from '../world/chunkGeometry';
import type { Biome, Cover } from '../world/biome';

// Until setTerrainMaterial runs, chunks render with this plain material.
let terrainMaterial: THREE.Material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });

/** Swaps the shared terrain material once its textures are ready. One instance for every chunk
 * (rule: no per-chunk material) — chunks built after the swap pick it up immediately. */
export function setTerrainMaterial(material: THREE.Material): void {
  terrainMaterial = material;
}

/** Texture repeats per world metre of the planar terrain UV (the spike's sand tiling). */
export const TERRAIN_UV_REPEATS_PER_METRE = 0.25;

/** Step A: one brightness multiplier on the sand texture per cover, so roads, rock and mud still
 * read apart until Step B gives each cover its own texture layer. */
const A_STEP_TINT_BY_COVER: Record<Cover, number> = {
  sand: 1,
  road: 0.45,
  gravel: 0.8,
  rock: 0.75,
  dirt: 0.85,
  dryGrass: 0.95,
  mud: 0.5,
  beach: 1.05,
  grass: 0.9,
  forest: 0.9,
  snow: 0.9,
  water: 0.9,
};

/**
 * Builds a chunk render mesh from its row-major height grid: an indexed grid with smooth
 * normals, a planar world-space `uv` and a per-vertex `color` tint from the cover at that vertex.
 * Vertices match the physics collider geometry.
 */
export function buildTerrainMesh(
  heights: Float32Array,
  originX: number,
  originZ: number,
  biome: Biome,
): THREE.Mesh {
  const { positions, indices } = buildChunkGeometry(heights, originX, originZ);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const normals = geometry.attributes.normal;
  const vertexCount = normals.count;
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    uvs[vertex * 2] = x * TERRAIN_UV_REPEATS_PER_METRE;
    uvs[vertex * 2 + 1] = z * TERRAIN_UV_REPEATS_PER_METRE;

    const normalY = normals.getY(vertex);
    const slope = Math.hypot(normals.getX(vertex), normals.getZ(vertex)) / Math.max(Math.abs(normalY), 1e-4);
    const tint = A_STEP_TINT_BY_COVER[biome.coverAt(x, z, y, slope)];
    colors[vertex * 3] = tint;
    colors[vertex * 3 + 1] = tint;
    colors[vertex * 3 + 2] = tint;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(geometry, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
