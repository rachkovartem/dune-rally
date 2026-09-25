// server/colliderStreamer.ts
// Builds terrain colliders on the server only where cars are, instead of the whole map at start.
// Built chunks are never removed: the map is finite and a heightfield chunk is small, so keeping
// them avoids rebuilding the same chunk every time a car comes back.
import { chunkKey, type ChunkCoord } from '../src/world/chunk';
import { chunkDemand, type ChunkDemandOptions, type MovingCar } from '../shared/chunkDemand';

/** Whatever actually adds the colliders of one chunk to the physics world. */
export interface ChunkColliderPort {
  build(chunk: ChunkCoord): void;
}

export interface ColliderStreamerOptions extends ChunkDemandOptions {
  /** Most `want` chunks built in one update; `must` chunks ignore it. */
  buildBudgetPerTick: number;
}

export class ColliderStreamer {
  private readonly built = new Set<string>();

  constructor(
    private readonly port: ChunkColliderPort,
    private readonly options: ColliderStreamerOptions,
  ) {
    if (!Number.isInteger(options.buildBudgetPerTick) || options.buildBudgetPerTick < 0) {
      throw new Error(`ColliderStreamer: bad buildBudgetPerTick ${options.buildBudgetPerTick}`);
    }
  }

  /**
   * Builds every missing chunk a car stands near, then at most the budget of the chunks it is
   * heading for, nearest first. A failing build is rethrown and retried on the next update.
   */
  update(cars: readonly MovingCar[]): void {
    const demand = chunkDemand(cars, this.options);
    for (const chunk of demand.must) this.build(chunk);
    let budget = this.options.buildBudgetPerTick;
    for (const chunk of demand.want) {
      if (budget <= 0) break;
      if (this.isBuilt(chunk)) continue;
      this.build(chunk);
      budget--;
    }
  }

  /** Builds one chunk now if it is missing; used to prepare the spawn area before anyone joins. */
  ensureBuilt(chunk: ChunkCoord): void {
    this.build(chunk);
  }

  isBuilt(chunk: ChunkCoord): boolean {
    return this.built.has(chunkKey(chunk));
  }

  builtCount(): number {
    return this.built.size;
  }

  private build(chunk: ChunkCoord): void {
    const key = chunkKey(chunk);
    if (this.built.has(key)) return;
    this.port.build(chunk);
    this.built.add(key);
  }
}
