// src/world/chunkGeometry.ts
import { CHUNK_SIZE, CHUNK_RES } from './chunk';
import { VERTS_PER_SIDE } from './heightfieldData';
import type { Height2D } from './noise';

export interface ChunkGeometry {
  /** World-space vertex positions, 3 floats (x, y, z) per vertex. */
  positions: Float32Array;
  /** Triangle indices into `positions` (2 triangles per grid cell). */
  indices: Uint32Array;
}

/**
 * Build the world-space render geometry for a chunk from its row-major height grid
 * (row = z, col = x). The heightfield collider splits each cell along the same diagonal.
 */
export function buildChunkGeometry(
  heights: Float32Array,
  originX: number,
  originZ: number,
): ChunkGeometry {
  const n = VERTS_PER_SIDE;
  const step = CHUNK_SIZE / (n - 1);

  const positions = new Float32Array(n * n * 3);
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const i = r * n + col;
      positions[i * 3 + 0] = originX + col * step; // world X
      positions[i * 3 + 1] = heights[i];           // world Y (up)
      positions[i * 3 + 2] = originZ + r * step;   // world Z
    }
  }

  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let r = 0; r < n - 1; r++) {
    for (let col = 0; col < n - 1; col++) {
      const a = r * n + col;
      const b = r * n + col + 1;
      const c = (r + 1) * n + col;
      const d = (r + 1) * n + col + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  return { positions, indices };
}

const GRID_STEP = CHUNK_SIZE / CHUNK_RES;

/**
 * Exact height of the rendered/collided terrain surface at (x, z) — the SAME value the chunk
 * mesh and heightfield collider use. The surface is a triangulated grid (step GRID_STEP), so this
 * barycentric-interpolates the triangle the point lands in, matching the mesh's faceting
 * exactly (unlike the smooth heightField, which deviates between grid vertices). Use this to
 * place anything that must sit precisely ON the ground (tyre tracks, decals).
 */
export function terrainSurfaceHeight(h: Height2D, x: number, z: number): number {
  const gx = Math.floor(x / GRID_STEP) * GRID_STEP;
  const gz = Math.floor(z / GRID_STEP) * GRID_STEP;
  const fx = (x - gx) / GRID_STEP;
  const fz = (z - gz) / GRID_STEP;
  const h00 = h(gx, gz);
  const h10 = h(gx + GRID_STEP, gz);
  const h01 = h(gx, gz + GRID_STEP);
  const h11 = h(gx + GRID_STEP, gz + GRID_STEP);
  // Mesh splits each cell into triangles (a,c,b) and (b,c,d); fx+fz<=1 is the first triangle.
  if (fx + fz <= 1) return h00 + fx * (h10 - h00) + fz * (h01 - h00);
  return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
}
