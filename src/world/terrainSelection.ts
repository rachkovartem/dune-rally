// src/world/terrainSelection.ts
import { CHUNK_SIZE, type ChunkCoord, chunkKey, chunksInRadius } from './chunk';
import type { MovingCar } from '../../shared/chunkDemand';

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

// Distances closer than this count as equal, so float noise does not decide the order.
const EQUAL_DISTANCE = 1e-6;

/**
 * Nearest chunk centre first; at equal distance the chunk further along the velocity comes first,
 * so the ground ahead of a fast car is built before the ground behind it. Returns a new array.
 */
export function orderChunkRequests(chunks: readonly ChunkCoord[], car: MovingCar): ChunkCoord[] {
  const keyed = chunks.map((chunk) => {
    const offsetX = (chunk.cx + 0.5) * CHUNK_SIZE - car.x;
    const offsetZ = (chunk.cz + 0.5) * CHUNK_SIZE - car.z;
    return { chunk, distance: Math.hypot(offsetX, offsetZ), ahead: offsetX * car.vx + offsetZ * car.vz };
  });
  keyed.sort((first, second) => {
    const distanceDifference = first.distance - second.distance;
    if (Math.abs(distanceDifference) > EQUAL_DISTANCE) return distanceDifference;
    return second.ahead - first.ahead;
  });
  return keyed.map((entry) => entry.chunk);
}
