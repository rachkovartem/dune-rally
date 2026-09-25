// src/world/terrainWorker.ts
import { createHeightField, type Height2D } from './noise';
import { createBiome, type Biome } from './biome';
import { generateChunkSurface } from './chunkSurface';

export interface TerrainChunkJob { kind: 'chunk'; seed: number; cx: number; cz: number }

export interface TerrainChunkResult {
  kind: 'chunk';
  cx: number;
  cz: number;
  /** Row-major height grid of the chunk, as `generateChunkSurface` returns it. */
  heights: Float32Array;
  /** Same layout as `heights`; each value is a `coverIndex`. */
  covers: Uint8Array;
}

let seedCached = -1;
let height: Height2D | null = null;
let biome: Biome | null = null;

self.onmessage = (event: MessageEvent<TerrainChunkJob>) => {
  const { seed, cx, cz } = event.data;
  if (height === null || biome === null || seed !== seedCached) {
    height = createHeightField(seed);
    biome = createBiome(seed);
    seedCached = seed;
  }
  const { heights, covers } = generateChunkSurface(height, biome, { cx, cz });
  const result: TerrainChunkResult = { kind: 'chunk', cx, cz, heights, covers };
  self.postMessage(result, { transfer: [heights.buffer, covers.buffer] });
};
