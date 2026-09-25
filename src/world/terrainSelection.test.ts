// src/world/terrainSelection.test.ts
import { describe, it, expect } from 'vitest';
import { diffChunks, orderChunkRequests } from './terrainSelection';
import { CHUNK_SIZE, chunkKey, chunksInRadius, type ChunkCoord } from './chunk';

describe('diffChunks', () => {
  it('loads the full radius when nothing is loaded', () => {
    const d = diffChunks(new Set(), { cx: 0, cz: 0 }, 1);
    expect(d.toLoad).toHaveLength(9);
    expect(d.toUnload).toHaveLength(0);
  });

  it('unloads chunks that fell out of radius', () => {
    const loaded = new Set([chunkKey({ cx: 5, cz: 5 }), chunkKey({ cx: 0, cz: 0 })]);
    const d = diffChunks(loaded, { cx: 0, cz: 0 }, 1);
    expect(d.toUnload).toEqual([chunkKey({ cx: 5, cz: 5 })]);
    expect(d.toLoad).not.toContainEqual({ cx: 0, cz: 0 });
  });

  it('is a no-op when already covering the radius', () => {
    const loaded = new Set([chunkKey({ cx: 0, cz: 0 })]);
    const d = diffChunks(loaded, { cx: 0, cz: 0 }, 0);
    expect(d.toLoad).toHaveLength(0);
    expect(d.toUnload).toHaveLength(0);
  });
});

describe('diffChunks with the render and collider radii (S0-5)', () => {
  it('unloads the collider of a chunk the car left 3 chunks behind, but keeps its mesh', () => {
    const start = { cx: 10, cz: 10 };
    const loaded = new Set(chunksInRadius(start, 2).map(chunkKey));
    const moved = { cx: 13, cz: 10 };
    expect(diffChunks(loaded, moved, 2).toUnload).toContain(chunkKey(start));
    expect(diffChunks(loaded, moved, 5).toUnload).not.toContain(chunkKey(start));
  });
});

describe('orderChunkRequests — which chunk the worker builds first (S0-5)', () => {
  const car = (x: number, z: number, vx: number, vz: number): { x: number; z: number; vx: number; vz: number } => ({ x, z, vx, vz });
  const centreOf = (cx: number, cz: number): { x: number; z: number } => ({ x: (cx + 0.5) * CHUNK_SIZE, z: (cz + 0.5) * CHUNK_SIZE });
  const keysOf = (chunks: readonly ChunkCoord[]): string[] => chunks.map(chunkKey);

  it('puts the nearest chunk first', () => {
    const at = centreOf(10, 10);
    const ordered = orderChunkRequests([{ cx: 13, cz: 10 }, { cx: 10, cz: 10 }, { cx: 11, cz: 11 }], car(at.x, at.z, 0, 0));
    expect(keysOf(ordered)).toEqual(['10,10', '11,11', '13,10']);
  });

  it('puts the chunk ahead of the car first when two are the same distance away', () => {
    const at = centreOf(10, 10);
    const eastAndWest = [{ cx: 9, cz: 10 }, { cx: 11, cz: 10 }];
    expect(keysOf(orderChunkRequests(eastAndWest, car(at.x, at.z, 40, 0)))[0]).toBe('11,10');
    expect(keysOf(orderChunkRequests(eastAndWest, car(at.x, at.z, -40, 0)))[0]).toBe('9,10');
  });

  it('orders by distance alone for a car standing still', () => {
    const at = centreOf(4, 4);
    const chunks = chunksInRadius({ cx: 4, cz: 4 }, 2);
    const distances = orderChunkRequests(chunks, car(at.x + 5, at.z - 9, 0, 0)).map((chunk) => {
      const centre = centreOf(chunk.cx, chunk.cz);
      return Math.hypot(centre.x - at.x - 5, centre.z - at.z + 9);
    });
    for (let index = 1; index < distances.length; index++) expect(distances[index]).toBeGreaterThanOrEqual(distances[index - 1]);
  });

  it('never lets the speed pull a farther chunk ahead of a nearer one', () => {
    const at = centreOf(10, 10);
    const ordered = orderChunkRequests([{ cx: 13, cz: 10 }, { cx: 9, cz: 10 }], car(at.x, at.z, 90, 0));
    expect(keysOf(ordered)).toEqual(['9,10', '13,10']);
  });

  it('answers an empty list for no chunks, and leaves the input list as it was', () => {
    expect(orderChunkRequests([], car(0, 0, 1, 1))).toEqual([]);
    const input = [{ cx: 5, cz: 5 }, { cx: 0, cz: 0 }];
    orderChunkRequests(input, car(0, 0, 0, 0));
    expect(keysOf(input)).toEqual(['5,5', '0,0']);
  });
});
