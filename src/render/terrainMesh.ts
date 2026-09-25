// src/render/terrainMesh.ts
import * as THREE from 'three';
import { buildChunkGeometry } from '../world/chunkGeometry';
import { coverFromIndex, type Cover } from '../world/biome';
import type { ChunkSurface } from '../world/chunkSurface';
import { borderDepth, smoothstep } from '../world/worldDef';
import { visualTerrainHeight } from './horizonShape';
import { VERTS_PER_SIDE } from '../world/heightfieldData';

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

/** Brightness the tyre tracks multiply their sand by, so a rut on a road reads like the road. */
export function coverTint(cover: Cover): number {
  return A_STEP_TINT_BY_COVER[cover];
}

/** How far the skirt hangs below each chunk edge: it hides the gap to a neighbour drawn a little lower. */
export const SKIRT_DEPTH = 1.5;

/**
 * Edge vertex indices of the row-major grid, one list per side, each walked so that
 * `cross(step along the edge, up)` points out of the chunk; that keeps the skirt faces outward.
 */
function chunkEdges(verticesPerSide: number): number[][] {
  const last = verticesPerSide - 1;
  const along = [...Array(verticesPerSide).keys()];
  const backward = [...along].reverse();
  return [
    backward.map((column) => column),                            // z = min, facing -z
    along.map((column) => last * verticesPerSide + column),      // z = max, facing +z
    along.map((row) => row * verticesPerSide),                   // x = min, facing -x
    backward.map((row) => row * verticesPerSide + last),         // x = max, facing +x
  ];
}

/** Hangs a vertical strip under every chunk edge. Skirt vertices copy the edge's normal, uv and
 * tint, so the lit seam looks like the ground above it. */
function withSkirts(geometry: THREE.BufferGeometry, verticesPerSide: number): void {
  const edges = chunkEdges(verticesPerSide);
  const gridVertexCount = geometry.attributes.position.count;
  const skirtVertexCount = edges.length * verticesPerSide;
  const index = geometry.getIndex();
  if (index === null) throw new Error('withSkirts: the chunk grid has no index');

  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    const size = attribute.itemSize;
    const values = new Float32Array((gridVertexCount + skirtVertexCount) * size);
    for (let item = 0; item < gridVertexCount * size; item++) values[item] = attribute.array[item];
    let skirtVertex = gridVertexCount;
    for (const edge of edges) {
      for (const edgeVertex of edge) {
        for (let component = 0; component < size; component++) {
          values[skirtVertex * size + component] = attribute.array[edgeVertex * size + component];
        }
        if (name === 'position') values[skirtVertex * size + 1] -= SKIRT_DEPTH;
        skirtVertex++;
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
  }

  const segmentsPerEdge = verticesPerSide - 1;
  const indices = new Uint32Array(index.count + edges.length * segmentsPerEdge * 6);
  for (let item = 0; item < index.count; item++) indices[item] = index.getX(item);
  let next = index.count;
  edges.forEach((edge, edgeNumber) => {
    const firstSkirtVertex = gridVertexCount + edgeNumber * verticesPerSide;
    for (let segment = 0; segment < segmentsPerEdge; segment++) {
      const topStart = edge[segment];
      const topEnd = edge[segment + 1];
      const bottomStart = firstSkirtVertex + segment;
      const bottomEnd = bottomStart + 1;
      indices[next++] = topStart; indices[next++] = bottomStart; indices[next++] = topEnd;
      indices[next++] = topEnd; indices[next++] = bottomStart; indices[next++] = bottomEnd;
    }
  });
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
}

/**
 * Smooth normals of a regular height grid from height differences to the neighbours (one-sided
 * on the chunk edge). A tenth of the cost of `computeVertexNormals`, which was most of a chunk build.
 */
function gridNormals(positions: Float32Array, verticesPerSide: number): Float32Array {
  const normals = new Float32Array(positions.length);
  const last = verticesPerSide - 1;
  const heightAt = (row: number, column: number): number => positions[(row * verticesPerSide + column) * 3 + 1];
  const xAt = (column: number): number => positions[column * 3];
  const zAt = (row: number): number => positions[row * verticesPerSide * 3 + 2];
  for (let row = 0; row < verticesPerSide; row++) {
    const rowBefore = Math.max(0, row - 1);
    const rowAfter = Math.min(last, row + 1);
    const spanZ = zAt(rowAfter) - zAt(rowBefore);
    for (let column = 0; column < verticesPerSide; column++) {
      const columnBefore = Math.max(0, column - 1);
      const columnAfter = Math.min(last, column + 1);
      const slopeX = (heightAt(row, columnAfter) - heightAt(row, columnBefore)) / (xAt(columnAfter) - xAt(columnBefore));
      const slopeZ = (heightAt(rowAfter, column) - heightAt(rowBefore, column)) / spanZ;
      const length = Math.hypot(slopeX, 1, slopeZ);
      const vertex = (row * verticesPerSide + column) * 3;
      normals[vertex] = -slopeX / length;
      normals[vertex + 1] = 1 / length;
      normals[vertex + 2] = -slopeZ / length;
    }
  }
  return normals;
}

/** How much of the rock layer a vertex shows: the whole border slope, and steep faces anywhere. */
function rockWeightAt(outside: number, slope: number): number {
  return Math.max(smoothstep(0.5, 4, outside), smoothstep(0.45, 0.9, slope));
}

/**
 * Builds a chunk render mesh from its row-major surface grid: an indexed grid with smooth
 * normals, a planar world-space `uv`, a per-vertex `color` tint from the surface cover and
 * a `rockWeight` for the terrain material's rock layer, plus skirts under the edges. Vertices match the physics collider
 * geometry everywhere a car can reach; only the ground past the border crest is drawn lower (horizonShape).
 */
export function buildTerrainMesh(surface: ChunkSurface, originX: number, originZ: number): THREE.Mesh {
  const { positions, indices } = buildChunkGeometry(surface.heights, originX, originZ);
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const x = positions[vertex * 3];
    const z = positions[vertex * 3 + 2];
    positions[vertex * 3 + 1] = visualTerrainHeight(positions[vertex * 3 + 1], x, z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('normal', new THREE.BufferAttribute(gridNormals(positions, VERTS_PER_SIDE), 3));

  const normals = geometry.attributes.normal;
  const vertexCount = normals.count;
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const rockWeights = new Float32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const x = positions[vertex * 3];
    const z = positions[vertex * 3 + 2];
    uvs[vertex * 2] = x * TERRAIN_UV_REPEATS_PER_METRE;
    uvs[vertex * 2 + 1] = z * TERRAIN_UV_REPEATS_PER_METRE;

    const normalY = normals.getY(vertex);
    const slope = Math.hypot(normals.getX(vertex), normals.getZ(vertex)) / Math.max(Math.abs(normalY), 1e-4);
    const rockWeight = rockWeightAt(borderDepth(x, z), slope);
    rockWeights[vertex] = rockWeight;
    const tint = A_STEP_TINT_BY_COVER[coverFromIndex(surface.covers[vertex])] * (1 - rockWeight) + rockWeight;
    colors[vertex * 3] = tint;
    colors[vertex * 3 + 1] = tint;
    colors[vertex * 3 + 2] = tint;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('rockWeight', new THREE.BufferAttribute(rockWeights, 1));
  withSkirts(geometry, VERTS_PER_SIDE);

  const mesh = new THREE.Mesh(geometry, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
