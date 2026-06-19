// src/world/terrainManager.ts
import * as THREE from 'three';
import { worldToChunk, chunkKey, chunkOrigin, type ChunkCoord } from './chunk';
import { diffChunks } from './terrainSelection';
import { buildTerrainMesh } from '../render/terrainMesh';
import { createChunkScatter } from '../render/scatter';
import type { Biome } from './biome';
import type { Height2D } from './noise';

interface Resp { cx: number; cz: number; heights: Float32Array }

export interface TerrainPhysicsHooks {
  onLoad(key: string, heights: Float32Array, originX: number, originZ: number): void;
  onUnload(key: string): void;
}

export class TerrainManager {
  private worker: Worker;
  private meshes = new Map<string, THREE.Mesh>();
  private scatter = new Map<string, THREE.Group>();
  private heights = new Map<string, Float32Array>();
  private pending = new Set<string>();

  constructor(
    private seed: number,
    private scene: THREE.Scene,
    private biome: Biome,
    private heightField: Height2D,
    private physics?: TerrainPhysicsHooks,
  ) {
    this.worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Resp>) => this.onChunk(e.data);
  }

  private onChunk({ cx, cz, heights }: Resp) {
    const key = chunkKey({ cx, cz });
    this.pending.delete(key);
    if (!this.isWanted({ cx, cz })) return; // moved away while generating
    const origin = chunkOrigin({ cx, cz });
    const mesh = buildTerrainMesh(heights, origin.x, origin.z, this.biome);
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
    this.heights.set(key, heights);

    const props = createChunkScatter(cx, cz, this.seed, this.heightField, this.biome);
    this.scene.add(props);
    this.scatter.set(key, props);

    this.physics?.onLoad(key, heights, origin.x, origin.z);
  }

  private wantedRadius = 0;
  private wantedCenter: ChunkCoord = { cx: 0, cz: 0 };
  private isWanted(c: ChunkCoord) {
    return Math.abs(c.cx - this.wantedCenter.cx) <= this.wantedRadius
      && Math.abs(c.cz - this.wantedCenter.cz) <= this.wantedRadius;
  }

  update(playerX: number, playerZ: number, radius: number) {
    this.wantedCenter = worldToChunk(playerX, playerZ);
    this.wantedRadius = radius;
    const loadedOrPending = new Set([...this.meshes.keys(), ...this.pending]);
    const { toLoad, toUnload } = diffChunks(loadedOrPending, this.wantedCenter, radius);

    for (const c of toLoad) {
      const key = chunkKey(c);
      this.pending.add(key);
      this.worker.postMessage({ seed: this.seed, cx: c.cx, cz: c.cz });
    }
    for (const key of toUnload) {
      const mesh = this.meshes.get(key);
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.meshes.delete(key);
      }
      const props = this.scatter.get(key);
      if (props) {
        this.scene.remove(props); // shared geometries/materials — don't dispose them
        this.scatter.delete(key);
      }
      this.heights.delete(key);
      this.physics?.onUnload(key);
    }
  }

  heightsFor(key: string): Float32Array | undefined {
    return this.heights.get(key);
  }
}
