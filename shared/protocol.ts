// shared/protocol.ts
import { DEFAULT_CAR_ID, isCarId, type CarId } from '../src/vehicle/cars';

export const SERVER_PORT = 2567;
export const TICK_HZ = 30;
export const PATCH_HZ = 20;
export const ARENA_CHUNKS = 8; // 8 × CHUNK_SIZE(64) = 512 → the bounded authored world

export interface InputMsg {
  throttle: number;
  brake: number;
  steer: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;

export function sanitizeInput(raw: Partial<InputMsg> | undefined): InputMsg {
  const r = raw ?? {};
  return {
    throttle: clamp(r.throttle ?? 0, 0, 1),
    brake: clamp(r.brake ?? 0, 0, 1),
    steer: clamp(r.steer ?? 0, -1, 1),
  };
}

export interface SelectCarMsg {
  carId: string;
}

export interface JoinOptions {
  name?: string;
  carId?: string;
}

// Protocol boundary: an old client, a typo or a hostile message still gets a car, so an unknown id
// falls back to the default car on purpose instead of rejecting the player.
export function sanitizeCarId(raw: unknown): CarId {
  return isCarId(raw) ? raw : DEFAULT_CAR_ID;
}
