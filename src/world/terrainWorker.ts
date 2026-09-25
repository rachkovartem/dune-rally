// src/world/terrainWorker.ts
import { createHeightField, type Height2D } from './noise';
import { createBiome, type Biome } from './biome';
import { generateChunkSurface } from './chunkSurface';
import { generateFarGrid, type FarGrid } from './farGrid';

export interface TerrainChunkJob { kind: 'chunk'; seed: number; cx: number; cz: number }
/** The coarse grid of the whole map, built once before the player starts. */
export interface TerrainFarJob { kind: 'far'; seed: number; step: number; margin: number }
export type TerrainWorkerJob = TerrainChunkJob | TerrainFarJob;

export interface TerrainChunkResult {
  kind: 'chunk';
  cx: number;
  cz: number;
  /** Row-major height grid of the chunk, as `generateChunkSurface` returns it. */
  heights: Float32Array;
  /** Same layout as `heights`; each value is a `coverIndex`. */
  covers: Uint8Array;
}

export interface TerrainFarResult { kind: 'far'; grid: FarGrid }
export type TerrainWorkerResult = TerrainChunkResult | TerrainFarResult;

let seedCached = -1;
let height: Height2D | null = null;
let biome: Biome | null = null;

function worldFor(seed: number): { height: Height2D; biome: Biome } {
  if (height === null || biome === null || seed !== seedCached) {
    height = createHeightField(seed);
    biome = createBiome(seed);
    seedCached = seed;
  }
  return { height, biome };
}

self.onmessage = (event: MessageEvent<TerrainWorkerJob>) => {
  const job = event.data;
  const world = worldFor(job.seed);
  if (job.kind === 'far') {
    const grid = generateFarGrid(world.height, world.biome, { step: job.step, margin: job.margin });
    const result: TerrainFarResult = { kind: 'far', grid };
    self.postMessage(result, { transfer: [grid.heights.buffer, grid.covers.buffer] });
    return;
  }
  const { heights, covers } = generateChunkSurface(world.height, world.biome, { cx: job.cx, cz: job.cz });
  const result: TerrainChunkResult = { kind: 'chunk', cx: job.cx, cz: job.cz, heights, covers };
  self.postMessage(result, { transfer: [heights.buffer, covers.buffer] });
};
