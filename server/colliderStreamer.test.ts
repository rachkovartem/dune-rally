// server/colliderStreamer.test.ts
import { describe, it, expect } from 'vitest';
import { ColliderStreamer, type ChunkColliderPort, type ColliderStreamerOptions } from './colliderStreamer';
import { CHUNK_SIZE, chunkKey, worldToChunk, type ChunkCoord } from '../src/world/chunk';
import type { MovingCar } from '../shared/chunkDemand';

const OPTIONS: ColliderStreamerOptions = { mustRadius: 1, wantRadius: 2, lookAheadSeconds: 1.5, worldChunks: 48, buildBudgetPerTick: 2 };

/** An in-memory physics world: remembers every chunk it was asked to build, in order. */
class RecordingPort implements ChunkColliderPort {
  readonly builds: string[] = [];
  failuresLeft = 0;

  build(chunk: ChunkCoord): void {
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new Error(`no heights for ${chunkKey(chunk)}`);
    }
    this.builds.push(chunkKey(chunk));
  }
}

const inChunk = (cx: number, cz: number): MovingCar => ({ x: (cx + 0.5) * CHUNK_SIZE, z: (cz + 0.5) * CHUNK_SIZE, vx: 0, vz: 0 });

describe('ColliderStreamer — terrain colliders only where cars are (S0-2)', () => {
  it('builds every chunk around a car in the same update, even with no budget left for the rest', () => {
    const port = new RecordingPort();
    const streamer = new ColliderStreamer(port, { ...OPTIONS, buildBudgetPerTick: 0 });
    streamer.update([inChunk(10, 10)]);
    expect(port.builds).toHaveLength(9);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) expect(streamer.isBuilt({ cx: 10 + dx, cz: 10 + dz })).toBe(true);
    }
  });

  it('builds at most the budget of the wanted chunks per update, nearest first', () => {
    const port = new RecordingPort();
    const streamer = new ColliderStreamer(port, OPTIONS);
    const car = { ...inChunk(10, 10), x: 10.9 * CHUNK_SIZE };
    streamer.update([car]);
    const extra = port.builds.slice(9);
    expect(extra).toHaveLength(OPTIONS.buildBudgetPerTick);
    // The car sits at the east edge of its chunk, so the next column east is nearest.
    for (const key of extra) expect(key.startsWith('12,')).toBe(true);
  });

  it('builds every wanted chunk over a few updates and never builds one twice', () => {
    const port = new RecordingPort();
    const streamer = new ColliderStreamer(port, OPTIONS);
    for (let update = 0; update < 20; update++) streamer.update([inChunk(10, 10)]);
    expect(streamer.builtCount()).toBe(25);
    expect(new Set(port.builds).size).toBe(port.builds.length);
  });

  it('keeps the chunks a car has left: nothing is ever unloaded', () => {
    const port = new RecordingPort();
    const streamer = new ColliderStreamer(port, OPTIONS);
    streamer.update([inChunk(5, 5)]);
    streamer.update([inChunk(30, 30)]);
    expect(streamer.isBuilt({ cx: 5, cz: 5 })).toBe(true);
    expect(streamer.isBuilt({ cx: 30, cz: 30 })).toBe(true);
  });

  it('rethrows a failed build and retries that chunk on the next update', () => {
    const port = new RecordingPort();
    const streamer = new ColliderStreamer(port, OPTIONS);
    port.failuresLeft = 1;
    expect(() => streamer.update([inChunk(10, 10)])).toThrow('no heights');
    expect(streamer.builtCount()).toBe(0);

    streamer.update([inChunk(10, 10)]);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) expect(streamer.isBuilt({ cx: 10 + dx, cz: 10 + dz })).toBe(true);
    }
  });

  it('builds a chunk asked for before anyone joins only once', () => {
    const port = new RecordingPort();
    const streamer = new ColliderStreamer(port, OPTIONS);
    streamer.ensureBuilt({ cx: 10, cz: 10 });
    streamer.update([inChunk(10, 10)]);
    expect(port.builds.filter((key) => key === '10,10')).toHaveLength(1);
  });

  it('throws for a budget that is not a whole number ≥ 0', () => {
    expect(() => new ColliderStreamer(new RecordingPort(), { ...OPTIONS, buildBudgetPerTick: -1 })).toThrow('bad buildBudgetPerTick');
    expect(() => new ColliderStreamer(new RecordingPort(), { ...OPTIONS, buildBudgetPerTick: 1.5 })).toThrow('bad buildBudgetPerTick');
  });

  it('never lets a car driving at 53 m/s for 20 s stand over a chunk with no collider', () => {
    // Regression: the server once had no ground under a fast car between its builds.
    const streamer = new ColliderStreamer(new RecordingPort(), { ...OPTIONS, buildBudgetPerTick: 1 });
    const car: MovingCar = { x: 100, z: 1500, vx: 53, vz: 0 };
    const step = 1 / 60;
    for (let time = 0; time < 20; time += step) {
      streamer.update([car]);
      // The physics step runs after the update, so the chunk the car moves into must already exist.
      car.x += car.vx * step;
      expect(streamer.isBuilt(worldToChunk(car.x, car.z))).toBe(true);
    }
  });
});
