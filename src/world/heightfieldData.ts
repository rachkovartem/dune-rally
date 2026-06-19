// src/world/heightfieldData.ts
import type { Height2D } from './noise';
import { CHUNK_SIZE, CHUNK_RES, type ChunkCoord, chunkOrigin } from './chunk';

export const VERTS_PER_SIDE = CHUNK_RES + 1;

export function generateChunkHeights(height: Height2D, c: ChunkCoord): Float32Array {
  const origin = chunkOrigin(c);
  const step = CHUNK_SIZE / CHUNK_RES;
  const grid = new Float32Array(VERTS_PER_SIDE * VERTS_PER_SIDE);
  for (let r = 0; r < VERTS_PER_SIDE; r++) {
    const z = origin.z + r * step;
    for (let col = 0; col < VERTS_PER_SIDE; col++) {
      const x = origin.x + col * step;
      grid[r * VERTS_PER_SIDE + col] = height(x, z);
    }
  }
  return grid;
}
