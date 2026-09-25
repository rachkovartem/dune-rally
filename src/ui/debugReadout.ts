// src/ui/debugReadout.ts
import type { Cover } from '../world/biome';
import type { ChunkCoord } from '../world/chunk';
import type { DriveState } from '../../shared/vehiclePhysics';

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

export interface SurfaceDebugSample {
  /** 0 firm .. 1 deep dune sand. */
  softness: number;
  /** Wheelspin of the driven wheels, m/s. */
  spin: number;
  /** Sinkage per wheel in wheel order (FL, FR, RL, RR), m. */
  sink: readonly number[];
  /** Share of the weight the wheels carry, 0..1. */
  wheelLoadShare: number;
  drive: DriveState;
}

const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;

/** Lines of the `?debug=1` readout for the ground under the tyres and the drive. */
export function formatSurfaceReadout(sample: SurfaceDebugSample): string[] {
  if (sample.sink.length !== WHEEL_NAMES.length) {
    throw new Error(`formatSurfaceReadout: expected ${WHEEL_NAMES.length} wheels, got ${sample.sink.length}`);
  }
  const sinkText = WHEEL_NAMES.map((name, wheelIndex) => `${name} ${Math.round(sample.sink[wheelIndex] * 100)}`).join(' ');
  const drive = sample.drive.drive;
  const driveText = drive.kind === 'fixed'
    ? drive.layout
    : `${drive.mode}${drive.requested === drive.mode ? '' : ` (asked ${drive.requested}${drive.blocked === null ? '' : `: ${drive.blocked}`})`}`;
  return [
    `softness ${sample.softness.toFixed(2)}  spin ${sample.spin.toFixed(1)} m/s  wheels carry ${Math.round(sample.wheelLoadShare * 100)}%`,
    `sink ${sinkText} cm`,
    `drive ${driveText}  TC ${sample.drive.tractionControl ? 'on' : 'off'}`,
  ];
}
