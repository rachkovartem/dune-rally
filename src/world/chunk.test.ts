// src/world/chunk.test.ts
import { describe, it, expect } from 'vitest';
import {
  CHUNK_SIZE, worldToChunk, chunkKey, chunkOrigin, chunksInRadius,
} from './chunk';

describe('chunk math', () => {
  it('maps world coords to chunk coords', () => {
    expect(worldToChunk(0, 0)).toEqual({ cx: 0, cz: 0 });
    expect(worldToChunk(CHUNK_SIZE - 1, 0)).toEqual({ cx: 0, cz: 0 });
    expect(worldToChunk(CHUNK_SIZE, 0)).toEqual({ cx: 1, cz: 0 });
    expect(worldToChunk(-1, -CHUNK_SIZE)).toEqual({ cx: -1, cz: -1 });
  });

  it('produces stable string keys', () => {
    expect(chunkKey({ cx: 2, cz: -3 })).toBe('2,-3');
  });

  it('returns the world origin of a chunk', () => {
    expect(chunkOrigin({ cx: 1, cz: -2 })).toEqual({ x: CHUNK_SIZE, z: -2 * CHUNK_SIZE });
  });

  it('lists chunks within a Chebyshev radius', () => {
    const r0 = chunksInRadius({ cx: 0, cz: 0 }, 0);
    expect(r0).toEqual([{ cx: 0, cz: 0 }]);
    const r1 = chunksInRadius({ cx: 0, cz: 0 }, 1);
    expect(r1).toHaveLength(9);
    expect(r1).toContainEqual({ cx: -1, cz: 1 });
  });
});
