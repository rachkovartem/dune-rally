// shared/protocol.ts
import { DEFAULT_CAR_ID, isCarId, type CarId } from '../src/vehicle/cars';
import { isDriveMode, type DriveMode } from './driveModes';

export const SERVER_PORT = 2567;
export const TICK_HZ = 30;
export const PATCH_HZ = 20;

// The server releases the pedals after this long without input; the client derives its heartbeat
// interval from it, so both sides share one number.
export const INPUT_TIMEOUT_SECONDS = 0.5;

export interface InputMsg {
  throttle: number;
  brake: number;
  steer: number;
  /** Absent means on: an old client never sends it, and its cars keep traction control. */
  tractionControl?: boolean;
  /** The drive mode the driver asks for; only a car with selectable drive uses it, absent keeps the current one. */
  driveMode?: DriveMode;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;

/** A field of a wire object; anything that is not an object has no fields. */
function fieldOf(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined;
}

const numberOr0 = (value: unknown): number => (typeof value === 'number' ? value : 0);

export function sanitizeInput(raw: unknown): InputMsg {
  const input: InputMsg = {
    throttle: clamp(numberOr0(fieldOf(raw, 'throttle')), 0, 1),
    brake: clamp(numberOr0(fieldOf(raw, 'brake')), 0, 1),
    steer: clamp(numberOr0(fieldOf(raw, 'steer')), -1, 1),
  };
  // The wire can carry anything: only a real boolean and a known mode get through.
  const tractionControl = fieldOf(raw, 'tractionControl');
  if (typeof tractionControl === 'boolean') input.tractionControl = tractionControl;
  const driveMode = fieldOf(raw, 'driveMode');
  if (isDriveMode(driveMode)) input.driveMode = driveMode;
  return input;
}

export const PLAYER_NAME_MAX_LENGTH = 24;
export const DEFAULT_PLAYER_NAME = 'rider';

// Control, bidi and invisible characters. Not all of \p{Cf}: the zero-width joiner (U+200D) is
// left in, because it holds emoji sequences together.
const HIDDEN_CHARACTERS =
  /[\p{Cc}\u061C\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/gu;

/**
 * The name other players see. A non-string in the state breaks the encoder for the whole room, so
 * only a string gets through: no control, bidi or invisible characters, trimmed, and at most
 * PLAYER_NAME_MAX_LENGTH characters (counted by code point, so an emoji is never cut in half).
 */
export function sanitizePlayerName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PLAYER_NAME;
  const printable = raw.replace(HIDDEN_CHARACTERS, '').trim();
  const name = Array.from(printable).slice(0, PLAYER_NAME_MAX_LENGTH).join('').trimEnd();
  return name === '' ? DEFAULT_PLAYER_NAME : name;
}

/** The car id and the name from a join; every other field of the join options is ignored. */
export function sanitizeJoinOptions(raw: unknown): { name: string; carId: CarId } {
  return { name: sanitizePlayerName(fieldOf(raw, 'name')), carId: sanitizeCarId(fieldOf(raw, 'carId')) };
}

// WebSocket close code (the 4000-4999 range is for applications) for a client that sends messages
// much faster than any real game client does.
export const MESSAGE_FLOOD_CLOSE_CODE = 4429;
// Close code for every client of a room whose state can no longer be encoded.
export const ROOM_BROKEN_CLOSE_CODE = 4500;

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

/** Wheelspin and sinkage of the driver's own car, so a snapped server copy is not left dug in. */
export interface PoseSurface {
  /** Wheelspin of the driven wheels, m/s, 0..POSE_MAX_SPIN. */
  spin: number;
  /** Sinkage per wheel (FL, FR, RL, RR), m, 0..POSE_MAX_SINK. */
  sink: number[];
  /** Per wheel, the way it dug its rut. */
  digDirection: (1 | -1)[];
}

export interface PoseMsg {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  surface?: PoseSurface;
}

const POSE_KEYS = ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'vx', 'vy', 'vz'] as const;
// Far outside any place a car can be, so a hostile value can never blow up the physics world.
const POSE_POSITION_LIMIT = 1e5;
const POSE_SPEED_LIMIT = 300;
const QUATERNION_LENGTH = { min: 0.9, max: 1.1 };
export const POSE_WHEEL_COUNT = 4;
export const POSE_MAX_SPIN = 20;
// Deeper than 0.6 × the biggest wheel radius (0.388 m) in the game.
export const POSE_MAX_SINK = 0.6;

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
  const pose: PoseMsg = { x, y, z, qx: qx / length, qy: qy / length, qz: qz / length, qw: qw / length, vx, vy, vz };
  const surface = sanitizePoseSurface(Reflect.get(raw, 'surface'));
  if (surface) pose.surface = surface;
  return pose;
}

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The surface part of a pose, or null when it is missing or malformed: the pose itself still counts. */
export function sanitizePoseSurface(raw: unknown): PoseSurface | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const spin: unknown = Reflect.get(raw, 'spin');
  const sink: unknown = Reflect.get(raw, 'sink');
  const digDirection: unknown = Reflect.get(raw, 'digDirection');
  if (!finiteNumber(spin)) return null;
  if (!Array.isArray(sink) || sink.length !== POSE_WHEEL_COUNT || !sink.every(finiteNumber)) return null;
  if (!Array.isArray(digDirection) || digDirection.length !== POSE_WHEEL_COUNT || !digDirection.every(finiteNumber)) return null;
  return {
    spin: Math.min(POSE_MAX_SPIN, Math.max(0, spin)),
    sink: sink.map((depth: number) => Math.min(POSE_MAX_SINK, Math.max(0, depth))),
    digDirection: digDirection.map((direction: number): 1 | -1 => (direction < 0 ? -1 : 1)),
  };
}
