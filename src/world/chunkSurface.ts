// src/world/chunkSurface.ts
// Heights and covers of one chunk grid, made where the heights are made (the terrain worker),
// so the main thread does not call coverAt once per vertex.
import { CHUNK_SIZE, CHUNK_RES, chunkOrigin, type ChunkCoord } from './chunk';
import { VERTS_PER_SIDE } from './heightfieldData';
import { coverIndex, surfaceTintAt, surfaceTintIndex, type Biome } from './biome';
import type { Height2D } from './noise';

export interface ChunkSurface {
  /** Row-major, row = z: the value at (col, row) is at index `row * VERTS_PER_SIDE + col`. */
  heights: Float32Array;
  /** Same layout as `heights`; each value is a `coverIndex`. */
  covers: Uint8Array;
}

export interface TintedChunkSurface extends ChunkSurface {
  /** Same layout as `heights`; each value is a `surfaceTintIndex`. */
  tints: Uint8Array;
}

export function generateChunkSurface(height: Height2D, biome: Biome, chunk: ChunkCoord): TintedChunkSurface {
  const origin = chunkOrigin(chunk);
  const step = CHUNK_SIZE / CHUNK_RES;
  // One extra ring of samples around the chunk, so the edge vertices get the same central
  // differences as their neighbours in the next chunk.
  const ringSide = VERTS_PER_SIDE + 2;
  const ring = new Float64Array(ringSide * ringSide);
  for (let ringRow = 0; ringRow < ringSide; ringRow++) {
    const z = origin.z + (ringRow - 1) * step;
    for (let ringCol = 0; ringCol < ringSide; ringCol++) {
      ring[ringRow * ringSide + ringCol] = height(origin.x + (ringCol - 1) * step, z);
    }
  }
  const ringAt = (col: number, row: number): number => ring[(row + 1) * ringSide + col + 1];

  const heights = new Float32Array(VERTS_PER_SIDE * VERTS_PER_SIDE);
  const covers = new Uint8Array(VERTS_PER_SIDE * VERTS_PER_SIDE);
  const tints = new Uint8Array(VERTS_PER_SIDE * VERTS_PER_SIDE);
  for (let row = 0; row < VERTS_PER_SIDE; row++) {
    const z = origin.z + row * step;
    for (let col = 0; col < VERTS_PER_SIDE; col++) {
      const x = origin.x + col * step;
      const groundHeight = ringAt(col, row);
      const slope = Math.hypot(
        ringAt(col + 1, row) - ringAt(col - 1, row),
        ringAt(col, row + 1) - ringAt(col, row - 1),
      ) / (2 * step);
      const index = row * VERTS_PER_SIDE + col;
      heights[index] = groundHeight;
      const cover = biome.coverAt(x, z, groundHeight, slope);
      covers[index] = coverIndex(cover);
      tints[index] = surfaceTintIndex(surfaceTintAt(x, z, cover));
    }
  }
  return { heights, covers, tints };
}
