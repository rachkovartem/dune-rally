// src/ui/debugReadout.ts
import type { Cover } from '../world/biome';
import type { ChunkCoord } from '../world/chunk';

export interface DebugSample {
  x: number;
  y: number;
  z: number;
  /** 0 = north (−z), 90 = east (+x). */
  headingDegrees: number;
  cover: Cover;
  grip: number;
  chunk: ChunkCoord;
  /** Chunks the server has built colliders for; null while the server does not report it. */
  serverChunks: number | null;
}

const NOT_REPORTED = '—';

/** Lines of the `?debug=1` readout for the local car. */
export function formatDebugReadout(sample: DebugSample): string[] {
  return [
    `x ${sample.x.toFixed(1)}  y ${sample.y.toFixed(1)}  z ${sample.z.toFixed(1)}  heading ${Math.round(sample.headingDegrees)}°`,
    `surface ${sample.cover}  grip ${sample.grip.toFixed(2)}`,
    `chunk ${sample.chunk.cx},${sample.chunk.cz}  server chunks ${sample.serverChunks === null ? NOT_REPORTED : String(sample.serverChunks)}`,
  ];
}
