// src/world/terrainSelection.ts
import { type ChunkCoord, chunkKey, chunksInRadius } from './chunk';

export interface ChunkDiff {
  toLoad: ChunkCoord[];
  toUnload: string[];
}

export function diffChunks(
  loadedKeys: Set<string>,
  center: ChunkCoord,
  radius: number,
): ChunkDiff {
  const needed = chunksInRadius(center, radius);
  const neededKeys = new Set(needed.map(chunkKey));

  const toLoad = needed.filter((c) => !loadedKeys.has(chunkKey(c)));
  const toUnload = [...loadedKeys].filter((k) => !neededKeys.has(k));
  return { toLoad, toUnload };
}
