// src/debug/globals.d.ts
import type { OrbitState } from '../render/chaseCamera';
import type { TerrainStats } from '../world/terrainManager';

declare global {
  interface Window {
    __dbg?: () => unknown;
    __tp?: (x: number, z: number) => void;
    __render?: { backend: string };
    /** The chase camera's live orbit, for matching screenshot angles. */
    __orbit?: OrbitState;
    __audio?: () => unknown;
    /** Client terrain streaming: chunk counts and main-thread build times. */
    __terrain?: () => TerrainStats;
    /** Far terrain layer: worker and main-thread build milliseconds, null until it is built. */
    __farTerrain?: { gridMs: number; meshMs: number } | null;
  }
}
