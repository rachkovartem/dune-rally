// shared/chunkDemand.ts
// Which terrain chunks must have a collider now, and which should be built next, for a set of
// moving cars. Pure, so the server streamer and its tests use the same answer.
import { CHUNK_SIZE, chunkKey, chunksInRadius, worldToChunk, type ChunkCoord } from '../src/world/chunk';

export interface MovingCar {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface ChunkDemandOptions {
  /** Chunks around each car that must exist before the next physics step (1 = 3 × 3). */
  mustRadius: number;
  /** Chunks around each car that should be built soon (2 = 5 × 5). */
  wantRadius: number;
  /** A must-sized ring around the point the car reaches in this many seconds is also wanted. */
  lookAheadSeconds: number;
  /** Chunks per world side; only indices in [0, worldChunks) are returned. */
  worldChunks: number;
}

export interface ChunkDemand {
  must: ChunkCoord[];
  /** Nearest to a car first, no duplicates, nothing that is already in `must`. */
  want: ChunkCoord[];
}

function checkOptions(options: ChunkDemandOptions): void {
  const { mustRadius, wantRadius, lookAheadSeconds, worldChunks } = options;
  if (!Number.isInteger(mustRadius) || mustRadius < 0) throw new Error(`chunkDemand: bad mustRadius ${mustRadius}`);
  if (!Number.isInteger(wantRadius) || wantRadius < 0) throw new Error(`chunkDemand: bad wantRadius ${wantRadius}`);
  if (!(lookAheadSeconds >= 0)) throw new Error(`chunkDemand: bad lookAheadSeconds ${lookAheadSeconds}`);
  if (!Number.isInteger(worldChunks) || worldChunks < 1) throw new Error(`chunkDemand: bad worldChunks ${worldChunks}`);
}

function checkCar(car: MovingCar): void {
  if (![car.x, car.z, car.vx, car.vz].every(Number.isFinite)) {
    throw new Error(`chunkDemand: a car has a position or velocity that is not a finite number: ${JSON.stringify(car)}`);
  }
}

function distanceToNearestCar(chunk: ChunkCoord, cars: readonly MovingCar[]): number {
  const centreX = (chunk.cx + 0.5) * CHUNK_SIZE;
  const centreZ = (chunk.cz + 0.5) * CHUNK_SIZE;
  let nearest = Infinity;
  for (const car of cars) nearest = Math.min(nearest, Math.hypot(centreX - car.x, centreZ - car.z));
  return nearest;
}

export function chunkDemand(cars: readonly MovingCar[], options: ChunkDemandOptions): ChunkDemand {
  checkOptions(options);
  const inWorld = (chunk: ChunkCoord): boolean =>
    chunk.cx >= 0 && chunk.cz >= 0 && chunk.cx < options.worldChunks && chunk.cz < options.worldChunks;

  const must = new Map<string, ChunkCoord>();
  const wanted = new Map<string, ChunkCoord>();
  const addTo = (target: Map<string, ChunkCoord>, chunks: readonly ChunkCoord[]): void => {
    for (const chunk of chunks) {
      if (inWorld(chunk)) target.set(chunkKey(chunk), chunk);
    }
  };
  for (const car of cars) {
    checkCar(car);
    const here = worldToChunk(car.x, car.z);
    addTo(must, chunksInRadius(here, options.mustRadius));
    addTo(wanted, chunksInRadius(here, options.wantRadius));
    const ahead = worldToChunk(car.x + car.vx * options.lookAheadSeconds, car.z + car.vz * options.lookAheadSeconds);
    addTo(wanted, chunksInRadius(ahead, options.mustRadius));
  }
  for (const key of must.keys()) wanted.delete(key);

  const want = [...wanted.values()]
    .map((chunk) => ({ chunk, distance: distanceToNearestCar(chunk, cars) }))
    .sort((a, b) => a.distance - b.distance || a.chunk.cz - b.chunk.cz || a.chunk.cx - b.chunk.cx)
    .map((entry) => entry.chunk);
  return { must: [...must.values()], want };
}
