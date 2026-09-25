// shared/driveModes.ts
// Selectable drive (Mitsubishi Super Select 4WD-II): which axles the engine drives, whether the
// centre differential is locked, and the low range. Pure functions, so client, server and bench agree.

export const DRIVE_MODES = ['2H', '4H', '4HLc', '4LLc'] as const;
export type DriveMode = (typeof DRIVE_MODES)[number];

export function isDriveMode(value: unknown): value is DriveMode {
  return typeof value === 'string' && DRIVE_MODES.some((mode) => mode === value);
}

export interface SelectableDriveSpec {
  /** The mode a new car starts in. */
  startMode: DriveMode;
  /** Transfer case low range: overall ratio multiplier in 4LLc. */
  lowRangeRatio: number;
  /** A change between high and low range is refused at or above this speed, m/s. */
  rangeChangeMaxSpeed: number;
  /** Share of the weight on the front axle, standing on flat ground. */
  frontLoadShare: number;
  /** Real height of the centre of mass, m: sets the load moved between the axles. */
  comHeight: number;
  /** Torque bias ratio of the centre differential in 4H (1 = fully open). */
  centreDiffBias: number;
}

/** Why the car is not in the mode the driver asked for; null when it is. */
export type DriveModeBlock = 'rangeChangeTooFast' | null;

export interface DriveModeResult {
  mode: DriveMode;
  blocked: DriveModeBlock;
}

export const isLowRange = (mode: DriveMode): boolean => mode === '4LLc';
export const isCentreLocked = (mode: DriveMode): boolean => mode === '4HLc' || mode === '4LLc';

/**
 * The mode after the driver asks for `requested` at `speed` (m/s, either direction). A change of
 * range needs the car almost stopped, like the real transfer case; the car then keeps its mode and
 * says why, so the HUD can show it.
 */
export function nextDriveMode(
  current: DriveMode,
  requested: DriveMode,
  speed: number,
  spec: Pick<SelectableDriveSpec, 'rangeChangeMaxSpeed'>,
): DriveModeResult {
  if (requested === current) return { mode: current, blocked: null };
  if (isLowRange(requested) !== isLowRange(current) && Math.abs(speed) >= spec.rangeChangeMaxSpeed) {
    return { mode: current, blocked: 'rangeChangeTooFast' };
  }
  return { mode: requested, blocked: null };
}

export interface AxleLoads {
  front: number;
  rear: number;
}

/**
 * Share of the weight on each axle (they sum to 1). The load moves to the rear when the nose points
 * up (`noseRise / upright` = tan of the slope) and when the car speeds up (`accelerationShare`, the
 * drive force as a share of the weight). On its side or roof both are 0.
 */
export function axleLoadShares(
  spec: Pick<SelectableDriveSpec, 'frontLoadShare' | 'comHeight'>,
  wheelbase: number,
  noseRise: number,
  upright: number,
  accelerationShare: number,
): AxleLoads {
  if (!(upright > 0)) return { front: 0, rear: 0 };
  const moved = (spec.comHeight / wheelbase) * (noseRise / upright + accelerationShare);
  const front = Math.min(1, Math.max(0, spec.frontLoadShare - moved));
  return { front, rear: 1 - front };
}

/**
 * Most drive force the two axles can pass to the ground together, N. The centre differential
 * splits the force at `rearShare`; a limited-slip one may move it up to `bias` times toward the
 * axle that grips better (1 = fully open, Infinity = locked). Past that the axle that runs out of
 * grip first sets the limit for both.
 */
export function centreDiffTraction(frontLimit: number, rearLimit: number, rearShare: number, bias: number): number {
  const both = frontLimit + rearLimit;
  if (rearShare <= 0) return frontLimit;
  if (rearShare >= 1) return rearLimit;
  if (!(bias >= 1)) throw new Error(`centreDiffTraction: bias ${bias} is below 1`);
  const nominal = rearShare / (1 - rearShare);
  const mostToRear = nominal * bias;
  const mostToFront = nominal / bias;
  if (rearLimit > mostToRear * frontLimit) return frontLimit * (1 + mostToRear);
  if (rearLimit < mostToFront * frontLimit) return rearLimit * (1 + 1 / mostToFront);
  return both;
}

// A locked centre differential makes both axles turn at one speed, but in a turn the front wheels
// run a longer path: on high-grip ground the tyres scrub, the car pushes wide and slows a little.
export const LOCKED_CENTRE_SCRUB = {
  /** Extra rolling resistance at full lock on firm ground. */
  rollingResistance: 0.03,
  /** Share of the front side grip lost at full lock on firm ground. */
  frontSideGripLoss: 0.15,
} as const;

/** How much a locked centre scrubs: 0 straight ahead or on loose ground, 1 at full lock on road. */
export function lockedScrubShare(steerAngle: number, maxSteer: number, looseness: number): number {
  if (!(maxSteer > 0)) return 0;
  return Math.min(1, Math.abs(steerAngle) / maxSteer) * (1 - Math.min(1, Math.max(0, looseness)));
}
