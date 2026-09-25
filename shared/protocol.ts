// shared/protocol.ts
import { DEFAULT_CAR_ID, isCarId, type CarId } from '../src/vehicle/cars';

export const SERVER_PORT = 2567;
export const TICK_HZ = 30;
export const PATCH_HZ = 20;

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

// R on the client: stand the player's own car back on its wheels. It carries no payload, and the
// server ignores anything sent with it.
export const RESET_CAR_MESSAGE = 'resetCar';

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

// The driver's own car, sent a few times a second, so the server copy others see can be corrected.
export const POSE_MESSAGE = 'pose';
export const POSE_HZ = 10;

export interface PoseMsg {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
}

const POSE_KEYS = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'vx', 'vy', 'vz'] as const;
// Far outside any place a car can be, so a hostile value can never blow up the physics world.
const POSE_POSITION_LIMIT = 1e5;
const POSE_SPEED_LIMIT = 300;
const QUATERNION_LENGTH = { min: 0.9, max: 1.1 };

function finiteField(raw: object, key: string): number | null {
  const value: unknown = Reflect.get(raw, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A pose from the wire, or null when any field is missing, not a finite number, or out of range. */
export function sanitizePose(raw: unknown): PoseMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const values: number[] = [];
  for (const key of POSE_KEYS) {
    const value = finiteField(raw, key);
    if (value === null) return null;
    values.push(value);
  }
  const [x, y, z, qx, qy, qz, qw, vx, vy, vz] = values;
  if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > POSE_POSITION_LIMIT) return null;
  if (Math.hypot(vx, vy, vz) > POSE_SPEED_LIMIT) return null;
  const length = Math.hypot(qx, qy, qz, qw);
  if (length < QUATERNION_LENGTH.min || length > QUATERNION_LENGTH.max) return null;
  return { x, y, z, qx: qx / length, qy: qy / length, qz: qz / length, qw: qw / length, vx, vy, vz };
}
