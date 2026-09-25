// shared/chunkDemand.test.ts
import { describe, it, expect } from 'vitest';
import { chunkDemand, type ChunkDemandOptions, type MovingCar } from './chunkDemand';
import { CHUNK_SIZE, chunkKey, type ChunkCoord } from '../src/world/chunk';

const OPTIONS: ChunkDemandOptions = { mustRadius: 1, wantRadius: 2, lookAheadSeconds: 1.5, worldChunks: 48 };

const keys = (chunks: readonly ChunkCoord[]): string[] => chunks.map(chunkKey);
const still = (x: number, z: number): MovingCar => ({ x, z, vx: 0, vz: 0 });
/** A car standing in the middle of chunk (cx, cz). */
const inChunk = (cx: number, cz: number): MovingCar => still((cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE);

describe('chunkDemand — which colliders a car needs (S0-2)', () => {
  it('never asks for a chunk outside the world for a car in its corner', () => {
    const demand = chunkDemand([{ x: 0, z: 0, vx: -60, vz: -60 }], OPTIONS);
    for (const chunk of [...demand.must, ...demand.want]) {
      expect(chunk.cx).toBeGreaterThanOrEqual(0);
      expect(chunk.cz).toBeGreaterThanOrEqual(0);
    }
    expect(keys(demand.must)).toContain('0,0');
  });

  it('never asks for a chunk past the far edge of the world', () => {
    const edge = OPTIONS.worldChunks * CHUNK_SIZE - 0.01;
    const demand = chunkDemand([{ x: edge, z: edge, vx: 60, vz: 60 }], OPTIONS);
    for (const chunk of [...demand.must, ...demand.want]) {
      expect(chunk.cx).toBeLessThan(OPTIONS.worldChunks);
      expect(chunk.cz).toBeLessThan(OPTIONS.worldChunks);
    }
  });

  it('covers both chunks of a car that stands exactly on the line between them', () => {
    const demand = chunkDemand([still(10 * CHUNK_SIZE, 10.5 * CHUNK_SIZE)], OPTIONS);
    expect(keys(demand.must)).toEqual(expect.arrayContaining(['9,10', '10,10']));
  });

  it('wants only the ring around a car that stands still: the look-ahead adds nothing', () => {
    const demand = chunkDemand([inChunk(20, 20)], OPTIONS);
    expect(demand.must).toHaveLength(9);
    expect(demand.want).toHaveLength(25 - 9);
  });

  it('wants the ground a fast car reaches in the look-ahead time, even outside its own ring', () => {
    const narrow: ChunkDemandOptions = { ...OPTIONS, wantRadius: 1 };
    const fast = { ...inChunk(20, 20), vx: 53 };
    expect(keys(chunkDemand([fast], narrow).want)).toContain('22,20');
    expect(keys(chunkDemand([inChunk(20, 20)], narrow).want)).not.toContain('22,20');
  });

  it('lists every chunk once when two cars share their rings', () => {
    const demand = chunkDemand([inChunk(20, 20), inChunk(21, 20)], OPTIONS);
    const mustKeys = keys(demand.must);
    const wantKeys = keys(demand.want);
    expect(new Set(mustKeys).size).toBe(mustKeys.length);
    expect(new Set(wantKeys).size).toBe(wantKeys.length);
    expect(wantKeys.filter((key) => mustKeys.includes(key))).toEqual([]);
  });

  it('orders the wanted chunks nearest to a car first', () => {
    const car = { x: 20.2 * CHUNK_SIZE, z: 20.7 * CHUNK_SIZE, vx: 30, vz: -10 };
    const distances = chunkDemand([car], OPTIONS).want.map((chunk) =>
      Math.hypot((chunk.cx + 0.5) * CHUNK_SIZE - car.x, (chunk.cz + 0.5) * CHUNK_SIZE - car.z));
    expect(distances.length).toBeGreaterThan(0);
    for (let index = 1; index < distances.length; index++) expect(distances[index]).toBeGreaterThanOrEqual(distances[index - 1]);
  });

  it('asks for nothing when there are no cars', () => {
    expect(chunkDemand([], OPTIONS)).toEqual({ must: [], want: [] });
  });

  it('throws for a car whose position is not a number, instead of building chunk NaN', () => {
    expect(() => chunkDemand([{ x: Number.NaN, z: 0, vx: 0, vz: 0 }], OPTIONS)).toThrow('not a finite number');
  });

  it.each<[string, Partial<ChunkDemandOptions>]>([
    ['a negative must radius', { mustRadius: -1 }],
    ['a fractional want radius', { wantRadius: 1.5 }],
    ['a negative look-ahead', { lookAheadSeconds: -1 }],
    ['an empty world', { worldChunks: 0 }],
  ])('throws for %s', (_name, change) => {
    expect(() => chunkDemand([inChunk(1, 1)], { ...OPTIONS, ...change })).toThrow('chunkDemand: bad');
  });
});
