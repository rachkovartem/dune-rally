// src/world/chunkSurface.test.ts
import { describe, it, expect } from 'vitest';
import { generateChunkSurface } from './chunkSurface';
import { generateChunkHeights, VERTS_PER_SIDE } from './heightfieldData';
import { coverFromIndex, createBiome } from './biome';
import { createHeightField } from './noise';
import type { ChunkCoord } from './chunk';

const height = createHeightField(1);
const biome = createBiome(1);
const LAST = VERTS_PER_SIDE - 1;

describe('generateChunkSurface — heights and covers made in the worker (R3a)', () => {
  it.each<[string, ChunkCoord]>([
    ['at the spawn', { cx: 24, cz: 31 }],
    ['on the north face', { cx: 20, cz: 1 }],
    ['outside the map', { cx: -1, cz: 2 }],
  ])('gives exactly the collider heights for a chunk %s', (_name, chunk) => {
    expect([...generateChunkSurface(height, biome, chunk).heights]).toEqual([...generateChunkHeights(height, chunk)]);
  });

  it('gives a vertex on a chunk edge the same cover in both chunks that share it', () => {
    // Regression: a slope from one-sided differences at the edge would paint a seam of other covers.
    for (const [west, east] of [[{ cx: 20, cz: 2 }, { cx: 21, cz: 2 }], [{ cx: 22, cz: 9 }, { cx: 23, cz: 9 }]]) {
      const westCovers = generateChunkSurface(height, biome, west).covers;
      const eastCovers = generateChunkSurface(height, biome, east).covers;
      for (let row = 0; row < VERTS_PER_SIDE; row++) {
        expect(westCovers[row * VERTS_PER_SIDE + LAST]).toBe(eastCovers[row * VERTS_PER_SIDE]);
      }
    }
  });

  it('paints the vertices on the border face rock', () => {
    const surface = generateChunkSurface(height, biome, { cx: 20, cz: 0 });
    for (const index of [0, LAST, LAST * VERTS_PER_SIDE]) expect(coverFromIndex(surface.covers[index])).toBe('rock');
  });
});
