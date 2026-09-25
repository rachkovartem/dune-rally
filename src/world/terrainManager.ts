// src/world/terrainManager.ts
import * as THREE from 'three';
import { CHUNK_SIZE, worldToChunk, chunkKey, chunkOrigin, chunksInRadius, type ChunkCoord } from './chunk';
import { diffChunks, orderChunkRequests } from './terrainSelection';
import { buildTerrainMesh } from '../render/terrainMesh';
import { createChunkScatter, releaseChunkScatter, type ChunkScatter } from '../render/scatter';
import type { SolidProp } from '../render/polyProps';
import type { Knockables } from '../render/knockables';
import type { Biome } from './biome';
import type { Height2D } from './noise';
import type { TerrainChunkJob, TerrainChunkResult, TerrainFarJob, TerrainWorkerResult } from './terrainWorker';
import type { FarGrid } from './farGrid';
import type { MovingCar } from '../../shared/chunkDemand';

export interface TerrainPhysicsHooks {
  onLoad(key: string, heights: Float32Array, originX: number, originZ: number, solidProps: readonly SolidProp[]): void;
  onUnload(key: string): void;
}

/** Chunks drawn around the car, in rings of chunks. */
export const RENDER_RADIUS = 5;
/** Chunks with a physics collider around the car; the rest of the drawn ground has none. */
export const COLLIDER_RADIUS = 2;
/** The drawn ring is also kept around where the car will be this many seconds ahead, so the far row
 * ahead is built before it enters the car's own ring. */
export const LOOK_AHEAD_SECONDS = 1.5;
// A teleport or a reset reads as a huge velocity for one frame; this cap keeps it from asking for a
// whole ring of chunks far away. Real driving (≤ 53 m/s → 80 m) stays under it.
const MAX_LOOK_AHEAD_METRES = 2 * CHUNK_SIZE;
/** Chunks outside the collider ring built per frame, so a row of arriving chunks never lands in one frame. */
export const MESH_BUILDS_PER_FRAME = 2;

/** Main-thread milliseconds, over the latest builds. */
export interface BuildTimeStats {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface TerrainStats {
  drawnChunks: number;
  colliderChunks: number;
  waitingForBuild: number;
  waitingForWorker: number;
  /** Chunks of the car's own drawn ring that are not drawn yet; 0 means no hole anywhere in view. */
  missingInCarRing: number;
  meshBuildMs: BuildTimeStats;
  colliderBuildMs: BuildTimeStats;
  mostBuildsInOneFrame: number;
}

const KEPT_TIMINGS = 400;

class Timings {
  private readonly values: number[] = [];
  add(milliseconds: number): void {
    this.values.push(milliseconds);
    if (this.values.length > KEPT_TIMINGS) this.values.shift();
  }
  stats(): BuildTimeStats {
    const sorted = [...this.values].sort((first, second) => first - second);
    const at = (fraction: number): number =>
      sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
    return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.length === 0 ? 0 : sorted[sorted.length - 1] };
  }
}

function isInside(chunk: ChunkCoord, center: ChunkCoord, radius: number): boolean {
  return Math.abs(chunk.cx - center.cx) <= radius && Math.abs(chunk.cz - center.cz) <= radius;
}

export class TerrainManager {
  private worker: Worker;
  private meshes = new Map<string, THREE.Mesh>();
  private scatter = new Map<string, ChunkScatter>();
  private heights = new Map<string, Float32Array>();
  private pending = new Set<string>();
  /** Surfaces back from the worker that still wait for their main-thread build. */
  private arrived = new Map<string, TerrainChunkResult>();
  private colliders = new Set<string>();
  private center: ChunkCoord | null = null;
  private wanted = new Set<string>();
  private readonly meshTimings = new Timings();
  private readonly colliderTimings = new Timings();
  private mostBuildsInOneFrame = 0;
  private readonly drawnChunks = new Map<string, ChunkCoord>();
  private readonly drawnListeners: ((chunk: ChunkCoord, drawn: boolean) => void)[] = [];

  constructor(
    private seed: number,
    private scene: THREE.Scene,
    private biome: Biome,
    private heightField: Height2D,
    private knockables: Knockables,
    private physics?: TerrainPhysicsHooks,
  ) {
    this.worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<TerrainWorkerResult>) => {
      if (event.data.kind !== 'chunk') throw new Error(`TerrainManager: the chunk worker answered a "${event.data.kind}" job it was never sent`);
      this.onChunk(event.data);
    };
  }

  /** Builds the coarse whole-map grid on a worker of its own, so the chunk queue near the car does not wait behind it. */
  requestFarGrid(step: number, margin: number): Promise<FarGrid> {
    const farWorker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    return new Promise<FarGrid>((resolve, reject) => {
      farWorker.onmessage = (event: MessageEvent<TerrainWorkerResult>) => {
        farWorker.terminate();
        if (event.data.kind === 'far') resolve(event.data.grid);
        else reject(new Error(`TerrainManager: the far-grid worker answered with a "${event.data.kind}" result`));
      };
      farWorker.onerror = (event) => {
        farWorker.terminate();
        reject(new Error(`TerrainManager: the far-grid worker failed: ${event.message}`));
      };
      const job: TerrainFarJob = { kind: 'far', seed: this.seed, step, margin };
      farWorker.postMessage(job);
    });
  }

  /** Called with every chunk whose near mesh is added to or removed from the scene, in that same frame. */
  onDrawnChange(listener: (chunk: ChunkCoord, drawn: boolean) => void): void {
    this.drawnListeners.push(listener);
    for (const chunk of this.drawnChunks.values()) listener(chunk, true);
  }

  private onChunk(result: TerrainChunkResult) {
    const key = chunkKey(result);
    this.pending.delete(key);
    // The car may have moved away while the worker was generating.
    if (!this.wanted.has(key)) return;
    this.arrived.set(key, result);
  }

  /** Call once per frame with the car's position and velocity (m/s). */
  update(x: number, z: number, vx: number, vz: number) {
    const center = worldToChunk(x, z);
    this.center = center;
    const car: MovingCar = { x, z, vx, vz };

    const lookAhead = Math.hypot(vx, vz) * LOOK_AHEAD_SECONDS;
    const lookAheadScale = lookAhead > MAX_LOOK_AHEAD_METRES ? MAX_LOOK_AHEAD_METRES / lookAhead : 1;
    const ahead = worldToChunk(
      x + vx * LOOK_AHEAD_SECONDS * lookAheadScale,
      z + vz * LOOK_AHEAD_SECONDS * lookAheadScale,
    );
    const known = new Set([...this.meshes.keys(), ...this.pending, ...this.arrived.keys()]);
    const aroundCar = diffChunks(known, center, RENDER_RADIUS);
    const aroundAhead = diffChunks(known, ahead, RENDER_RADIUS);
    const toLoad = new Map([...aroundCar.toLoad, ...aroundAhead.toLoad].map((chunk) => [chunkKey(chunk), chunk]));
    const unwantedAhead = new Set(aroundAhead.toUnload);
    const toUnload = aroundCar.toUnload.filter((key) => unwantedAhead.has(key));
    this.wanted = new Set([...chunksInRadius(center, RENDER_RADIUS), ...chunksInRadius(ahead, RENDER_RADIUS)].map(chunkKey));

    for (const chunk of orderChunkRequests([...toLoad.values()], car)) {
      this.pending.add(chunkKey(chunk));
      const job: TerrainChunkJob = { kind: 'chunk', seed: this.seed, cx: chunk.cx, cz: chunk.cz };
      this.worker.postMessage(job);
    }
    for (const key of toUnload) this.unloadChunk(key);

    this.buildArrived(center, car);

    const colliderChanges = diffChunks(this.colliders, center, COLLIDER_RADIUS);
    for (const key of colliderChanges.toUnload) this.unloadCollider(key);
    for (const chunk of colliderChanges.toLoad) this.loadCollider(chunk);
  }

  /** Chunks inside the collider ring are built at once (the car can reach them); the rest wait their turn. */
  private buildArrived(center: ChunkCoord, car: MovingCar): void {
    if (this.arrived.size === 0) return;
    const waiting = [...this.arrived.values()].map((result): ChunkCoord => ({ cx: result.cx, cz: result.cz }));
    let builds = 0;
    for (const chunk of orderChunkRequests(waiting, car)) {
      const mustBuild = isInside(chunk, center, COLLIDER_RADIUS);
      if (!mustBuild && builds >= MESH_BUILDS_PER_FRAME) continue;
      const key = chunkKey(chunk);
      const result = this.arrived.get(key);
      if (!result) continue;
      this.arrived.delete(key);
      this.buildChunk(key, result);
      builds++;
    }
    this.mostBuildsInOneFrame = Math.max(this.mostBuildsInOneFrame, builds);
  }

  private buildChunk(key: string, { cx, cz, heights, covers, tints }: TerrainChunkResult): void {
    const started = performance.now();
    const origin = chunkOrigin({ cx, cz });
    const mesh = buildTerrainMesh({ heights, covers, tints }, origin.x, origin.z);
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
    this.drawnChunks.set(key, { cx, cz });
    for (const listener of this.drawnListeners) listener({ cx, cz }, true);
    this.heights.set(key, heights);

    const scatter = createChunkScatter(cx, cz, this.seed, this.heightField, this.biome);
    this.scene.add(scatter.group);
    this.scatter.set(key, scatter);
    for (const knockable of scatter.knockables) this.knockables.add(knockable);
    this.meshTimings.add(performance.now() - started);
  }

  private loadCollider(chunk: ChunkCoord): void {
    const key = chunkKey(chunk);
    const heights = this.heights.get(key);
    const scatter = this.scatter.get(key);
    // Not built yet: the next update after its build adds the collider.
    if (!heights || !scatter) return;
    const started = performance.now();
    const origin = chunkOrigin(chunk);
    this.physics?.onLoad(key, heights, origin.x, origin.z, scatter.solids);
    this.colliders.add(key);
    this.colliderTimings.add(performance.now() - started);
  }

  private unloadCollider(key: string): void {
    if (!this.colliders.delete(key)) return;
    this.physics?.onUnload(key);
  }

  private unloadChunk(key: string): void {
    this.unloadCollider(key);
    this.arrived.delete(key);
    const mesh = this.meshes.get(key);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(key);
    }
    const drawn = this.drawnChunks.get(key);
    if (drawn) {
      this.drawnChunks.delete(key);
      for (const listener of this.drawnListeners) listener(drawn, false);
    }
    const scatter = this.scatter.get(key);
    if (scatter) {
      this.scene.remove(scatter.group); // shared geometries/materials — don't dispose them
      for (const knockable of scatter.knockables) this.knockables.remove(knockable);
      releaseChunkScatter(scatter);
      this.scatter.delete(key);
    }
    this.heights.delete(key);
  }

  heightsFor(key: string): Float32Array | undefined {
    return this.heights.get(key);
  }

  stats(): TerrainStats {
    return {
      drawnChunks: this.meshes.size,
      colliderChunks: this.colliders.size,
      waitingForBuild: this.arrived.size,
      waitingForWorker: this.pending.size,
      missingInCarRing: this.center === null
        ? chunksInRadius({ cx: 0, cz: 0 }, RENDER_RADIUS).length
        : chunksInRadius(this.center, RENDER_RADIUS).filter((chunk) => !this.meshes.has(chunkKey(chunk))).length,
      meshBuildMs: this.meshTimings.stats(),
      colliderBuildMs: this.colliderTimings.stats(),
      mostBuildsInOneFrame: this.mostBuildsInOneFrame,
    };
  }
}
