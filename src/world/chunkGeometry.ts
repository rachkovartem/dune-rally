// src/world/chunkGeometry.ts
import { CHUNK_SIZE } from './chunk';
import { VERTS_PER_SIDE } from './heightfieldData';

export interface ChunkGeometry {
  /** World-space vertex positions, 3 floats (x, y, z) per vertex. */
  positions: Float32Array;
  /** Triangle indices into `positions` (2 triangles per grid cell). */
  indices: Uint32Array;
}

/**
 * Build the shared world-space geometry for a chunk from its row-major height grid
 * (row = z, col = x). Used by BOTH the render mesh and the physics trimesh collider so
 * the two are guaranteed identical — this removes the heightfield-orientation ambiguity
 * that a Rapier heightfield collider would reintroduce.
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
