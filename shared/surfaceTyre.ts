// shared/surfaceTyre.ts
// How the ground changes the tyres: side grip that slides on loose ground, wheelspin held by
// traction control, and wheels that dig into soft sand. Pure functions, no Rapier, so the local car,
// the server copy and the bench step the same numbers.

export const SURFACE_TYRE = Object.freeze({
  /** Side friction of a real tyre on the best loose ground (grip 1). */
  looseSideFriction: 1.25,
  /** Looseness from which the side grip is fully the loose-ground value; firmer ground blends toward the config value. */
  fullLooseFrom: 0.5,
  /** Slip angle (rad) where the side grip peaks, firm and loose. */
  peakSlipFirm: 0.1,
  peakSlipLoose: 0.16,
  /** Share of the side grip lost well past the peak, firm and loose. */
  dropFirm: 0.05,
  dropLoose: 0.25,
  /** Slip angle range (rad) over which the side grip falls after the peak. */
  dropRange: 0.3,
  /** Below this speed along the wheel (m/s) the slip angle is measured against it, so a standing car stays sane. */
  slipSpeedFloor: 1.5,
  /** Rapier side-constraint stiffness on the loosest ground: lower = softer, more slide. The rear
   * matches the front below its peak slip, else the car oversteers and will not run straight. */
  frontStiffnessLoose: 0.6,
  rearStiffnessLoose: 0.2,
  /** Rear slip angle, as a share of the peak slip, where the rear starts to soften, and where it is fully soft. */
  rearSoftenFrom: 0.5,
  rearSoftFrom: 1,
  /** A sliding tyre still keys into the ground a little: the side grip left at full spin. */
  spinSideFloor: 0.3,
  /** Side slip (m/s) added before the side share of a spinning tyre is taken. */
  spinSideReference: 1,
  /** A tyre that uses all its grip to drive still keeps this share sideways. */
  frictionCircleFloor: 0.25,

  /** Traction control on firm ground: spin allowed at a standstill (m/s) and per m/s of speed. */
  firmSpinAllowance: 0.3,
  firmSpinRatio: 0.05,
  /** Spin (m/s) where a tyre is fully sliding, and the drive lost then on the loosest ground. */
  fullSlideSpin: 3,
  slideDriveLoss: 0.03,
  /** With traction control off the spin still stops here, m/s (the pose message clamps to it too). */
  maxSpin: 20,
  /** The spin never reacts with less mass than this share of the car (a light driveline stays stable). */
  minSpinInertiaShare: 0.05,

  /** Sinkage of a standing wheel at softness 1 and flotation 1, m; it halves at `floatSpeed`. */
  staticSink: 0.03,
  floatSpeed: 5,
  /** A wheel sinks back to its static depth at most this fast, m/s. */
  settleRate: 0.05,
  /** Metres of sinkage per metre of excess spin at softness 1; the first `freeSpin` m/s does not dig. */
  digRate: 0.05,
  freeSpin: 1,
  /** Share of the extra sinkage lost per metre rolled. */
  climbRate: 0.35,
  /** Rolling back over your own rut: climbs out faster and digs less. */
  ownTrackClimb: 5,
  ownTrackDig: 0.3,
  /** Sinkage (m) above the static depth that counts as a rut. */
  rutDepth: 0.005,
  /** Deepest sinkage as a share of the wheel radius (the sill or the axle is on the sand by then). */
  maxSinkShare: 0.6,
  /** Firm ground: share of the sinkage lost per second, plus a constant rate (m/s). */
  firmRecover: 3,
  firmRecoverConstant: 0.02,
  /** Extra rolling resistance per (extra sinkage / radius), and its share on your own track. */
  bulldoze: 0.6,
  ownTrackBulldoze: 0.05,
  /** Base rolling resistance share left while rolling on your own track. */
  ownTrackRolling: 0.5,
  /** Traction lost when the driven wheels are at the deepest sinkage. */
  tractionLossAtMax: 0.25,
  /** Seconds over which the share of the weight on the wheels follows the measured one. */
  loadShareSeconds: 0.2,
  /** Friction of the chassis box on soft ground: the belly slides on sand. */
  bellyFriction: 0.3,

  /** Counter-steer assist: slide (rad) left alone, and the share of the rest steered against. */
  countersteerFreeSlip: (4 * Math.PI) / 180,
  countersteerGain: 1,
  /** Below this flat speed (m/s) there is no assist. */
  countersteerMinSpeed: 3,
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

const dot = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Per-car traction-control values on the loosest ground. */
export interface SpinAllowanceSpec {
  /** Spin allowed at a standstill, m/s. */
  spinAllowance: number;
  /** Extra spin allowed per m/s of speed. */
  spinAllowanceRatio: number;
}

/** How much wheelspin traction control allows, m/s. Firm ground allows little, loose ground the car's value. */
export function spinAllowance(car: SpinAllowanceSpec, looseness: number, speed: number): number {
  const loose = clamp01(looseness);
  const base = SURFACE_TYRE.firmSpinAllowance + (car.spinAllowance - SURFACE_TYRE.firmSpinAllowance) * loose;
  const ratio = SURFACE_TYRE.firmSpinRatio + (car.spinAllowanceRatio - SURFACE_TYRE.firmSpinRatio) * loose;
  return base + ratio * Math.abs(speed);
}

export interface SpinStepInput {
  /** Spin before this step, m/s (≥ 0), and the way it turned. */
  spin: number;
  spinDirection: 1 | -1;
  /** Pedal: share of drive (0 = no drive) and its direction. */
  drive: number;
  direction: 1 | -1;
  /** Signed engine force at the tyres, computed at the wheel surface speed, N. */
  demandedForce: number;
  /** Most force the driven tyres pass to the ground without spinning, N. */
  peakTraction: number;
  looseness: number;
  /** Spin traction control allows, m/s; null when the driver switched it off. */
  allowance: number | null;
  /** Mass that the spin has to speed up (engine, gears and wheels seen at the tyre), kg. */
  spinInertia: number;
  /** True when at least one driven wheel touches the ground. */
  drivenInContact: boolean;
  dt: number;
}

export interface SpinStepResult {
  spin: number;
  spinDirection: 1 | -1;
  /** Signed drive force the tyres pass to the ground, N. */
  tyreForce: number;
}

/**
 * Stick-slip wheelspin shared by the driven wheels. While the demand fits under the peak the tyre
 * grips and the force is the demand, as without this model. Above it the excess spins the wheels
 * up, and traction control stops the spin at its allowance.
 */
export function spinStep(input: SpinStepInput): SpinStepResult {
  if (input.drive <= 0) return { spin: 0, spinDirection: input.direction, tyreForce: input.demandedForce };
  // The wheels are turned the other way now: the old spin is gone.
  const spinBefore = input.direction === input.spinDirection ? input.spin : 0;
  if (!input.drivenInContact) return { spin: spinBefore, spinDirection: input.direction, tyreForce: input.demandedForce };
  const magnitude = Math.abs(input.demandedForce);
  if (spinBefore <= 0 && magnitude <= input.peakTraction) {
    return { spin: 0, spinDirection: input.direction, tyreForce: input.demandedForce };
  }
  const slideShare = Math.min(1, spinBefore / SURFACE_TYRE.fullSlideSpin);
  const slideTraction = input.peakTraction * (1 - SURFACE_TYRE.slideDriveLoss * clamp01(input.looseness) * slideShare);
  let excess = magnitude - slideTraction;
  if (input.allowance !== null && spinBefore >= input.allowance && excess > 0) excess = 0;
  let spin = Math.max(0, spinBefore + (excess / input.spinInertia) * input.dt);
  if (input.allowance !== null) spin = Math.min(spin, input.allowance);
  spin = Math.min(spin, SURFACE_TYRE.maxSpin);
  return { spin, spinDirection: input.direction, tyreForce: input.direction * Math.min(magnitude, slideTraction) };
}

/** Slip angle of one tyre, rad (≥ 0): how far its contact point moves across the wheel's heading. */
export function slipAngle(contactVelocity: Vector3, wheelHeading: Vector3, wheelAxle: Vector3): number {
  const along = dot(contactVelocity, wheelHeading);
  const across = dot(contactVelocity, wheelAxle);
  return Math.atan2(Math.abs(across), Math.max(Math.abs(along), SURFACE_TYRE.slipSpeedFloor));
}

export interface SideGripInput {
  /** The car's side friction on firm ground (config `wheel.frictionSlip`). */
  configFrictionSlip: number;
  /** Ground grip after the sinkage traction loss. */
  grip: number;
  lateralFactor: number;
  looseness: number;
  rear: boolean;
  /** Per car: the rear side grip share taken away on the loosest ground (the drift knob). */
  tailLooseness: number;
  slipAngle: number;
  /** Speed of the contact point across the wheel, m/s (≥ 0). */
  lateralSlipSpeed: number;
  /** Wheelspin of this wheel, m/s; 0 for a wheel that is not driven. */
  spin: number;
  /** Drive or brake force on this wheel divided by its load. */
  usedFriction: number;
  /** Share of the side grip lost to the scrub of a locked centre (front wheels only), 0..1. */
  scrubLoss: number;
}

export interface SideGrip {
  /** Rapier `frictionSlip` for this wheel: the cap of its side impulse. */
  frictionSlip: number;
  /** Rapier `sideFrictionStiffness` for this wheel. */
  stiffness: number;
}

/**
 * Side grip of one wheel for this step. Firm ground keeps the config value; loose ground blends
 * toward a real tyre whose grip peaks and then falls, with a looser rear so the tail can step out.
 */
export function sideGrip(input: SideGripInput): SideGrip {
  const loose = clamp01(input.looseness);
  const realism = Math.min(1, loose / SURFACE_TYRE.fullLooseFrom);
  const rearBias = input.rear ? 1 - input.tailLooseness * loose : 1;
  const firm = input.configFrictionSlip * input.grip;
  const real = SURFACE_TYRE.looseSideFriction * input.grip * input.lateralFactor;
  const peak = ((1 - realism) * firm + realism * real) * rearBias * (1 - clamp01(input.scrubLoss));
  const peakSlip = SURFACE_TYRE.peakSlipFirm + (SURFACE_TYRE.peakSlipLoose - SURFACE_TYRE.peakSlipFirm) * loose;
  const drop = SURFACE_TYRE.dropFirm + (SURFACE_TYRE.dropLoose - SURFACE_TYRE.dropFirm) * loose;
  let friction = peak * (1 - drop * clamp01((input.slipAngle - peakSlip) / SURFACE_TYRE.dropRange));
  if (input.spin > 0) {
    // A spinning tyre slides mostly along the car, so little of its friction points sideways.
    const across = input.lateralSlipSpeed + SURFACE_TYRE.spinSideReference;
    friction *= SURFACE_TYRE.spinSideFloor + (1 - SURFACE_TYRE.spinSideFloor) * (across / Math.hypot(across, input.spin));
  }
  const floor = SURFACE_TYRE.frictionCircleFloor * friction;
  const used = Math.abs(input.usedFriction);
  const pastPeak = clamp01((input.slipAngle / peakSlip - SURFACE_TYRE.rearSoftenFrom) / (SURFACE_TYRE.rearSoftFrom - SURFACE_TYRE.rearSoftenFrom));
  const looseStiffness = input.rear
    ? SURFACE_TYRE.frontStiffnessLoose + (SURFACE_TYRE.rearStiffnessLoose - SURFACE_TYRE.frontStiffnessLoose) * pastPeak
    : SURFACE_TYRE.frontStiffnessLoose;
  return {
    frictionSlip: Math.sqrt(Math.max(floor * floor, friction * friction - used * used)),
    stiffness: 1 + (looseStiffness - 1) * loose,
  };
}

/** Sinkage (m) a wheel settles to while it rolls at `speed` on ground of `softness`. */
export function staticSinkage(softness: number, flotation: number, speed: number): number {
  return (clamp01(softness) * SURFACE_TYRE.staticSink) / flotation / (1 + Math.abs(speed) / SURFACE_TYRE.floatSpeed);
}

/**
 * True when a wheel rolls back over the rut it dug: it moves (`moving` = -1 or 1) against the way
 * it dug and sits clearly deeper than its static depth.
 */
export function onOwnTrack(moving: -1 | 0 | 1, digDirection: 1 | -1, sink: number, staticSink: number): boolean {
  return moving !== 0 && moving !== digDirection && sink - staticSink > SURFACE_TYRE.rutDepth;
}

/**
 * Which way the wheels roll: the car's own motion, or at a standstill the way the pedal pushes,
 * so the reverse escape can start from a dead stop.
 */
export function rollingDirection(forwardSpeed: number, drive: number, direction: 1 | -1): -1 | 0 | 1 {
  if (Math.abs(forwardSpeed) > 0.05) return forwardSpeed > 0 ? 1 : -1;
  return drive > 0 ? direction : 0;
}

export interface SinkStepInput {
  sink: number;
  digDirection: 1 | -1;
  softness: number;
  flotation: number;
  /** Forward speed of the car, m/s (either sign). */
  speed: number;
  moving: -1 | 0 | 1;
  /** Wheelspin of this wheel, m/s; 0 when not driven. */
  spin: number;
  /** Direction the pedal drives in. */
  driveDirection: 1 | -1;
  radius: number;
  dt: number;
}

export interface SinkStepResult {
  sink: number;
  digDirection: 1 | -1;
}

/**
 * Sinkage of one wheel after a step. Spin digs, rolling climbs out, and rolling back over your own
 * rut climbs out fastest. Firm ground lifts the wheel out at once.
 */
export function sinkStep(input: SinkStepInput): SinkStepResult {
  const maxSink = SURFACE_TYRE.maxSinkShare * input.radius;
  if (!(input.softness > 0)) {
    const sink = input.sink - (input.sink * SURFACE_TYRE.firmRecover + SURFACE_TYRE.firmRecoverConstant) * input.dt;
    return { sink: Math.min(maxSink, Math.max(0, sink)), digDirection: input.digDirection };
  }
  const settled = staticSinkage(input.softness, input.flotation, input.speed);
  const ownTrack = onOwnTrack(input.moving, input.digDirection, input.sink, settled);
  const dig = (SURFACE_TYRE.digRate * clamp01(input.softness) * Math.max(0, input.spin - SURFACE_TYRE.freeSpin)
    * (ownTrack ? SURFACE_TYRE.ownTrackDig : 1)) / input.flotation;
  const climb = SURFACE_TYRE.climbRate * Math.abs(input.speed) * Math.max(0, input.sink - settled)
    * (ownTrack ? SURFACE_TYRE.ownTrackClimb : 1);
  let sink = input.sink + (dig - climb) * input.dt;
  if (sink < settled) sink = Math.min(settled, input.sink + SURFACE_TYRE.settleRate * input.dt);
  const digDirection = dig > 0 && !ownTrack ? input.driveDirection : input.digDirection;
  return { sink: Math.min(maxSink, Math.max(0, sink)), digDirection };
}

export interface SinkEffectsInput {
  sinks: readonly number[];
  /** Per wheel: rolling back over its own rut. */
  ownTrack: readonly boolean[];
  drivenWheels: readonly number[];
  staticSink: number;
  radius: number;
  baseRollingResistance: number;
}

export interface SinkEffects {
  rollingResistance: number;
  /** Multiplier of the ground grip: deep driven wheels hold less. */
  gripFactor: number;
}

/**
 * What the sinkage costs. Only the depth above the static value counts, because the base sand
 * rolling resistance already stands for a tyre sitting in sand.
 */
export function sinkEffects(input: SinkEffectsInput): SinkEffects {
  const count = input.sinks.length;
  if (count === 0) return { rollingResistance: input.baseRollingResistance, gripFactor: 1 };
  let bulldoze = 0;
  let ownTrackWheels = 0;
  for (let wheelIndex = 0; wheelIndex < count; wheelIndex++) {
    const extra = Math.max(0, input.sinks[wheelIndex] - input.staticSink);
    const ownTrack = input.ownTrack[wheelIndex] === true;
    if (ownTrack) ownTrackWheels++;
    bulldoze += (extra / input.radius) * (ownTrack ? SURFACE_TYRE.ownTrackBulldoze : 1);
  }
  let drivenExtra = 0;
  for (const wheelIndex of input.drivenWheels) {
    drivenExtra += Math.max(0, (input.sinks[wheelIndex] ?? 0) - input.staticSink);
  }
  const meanDrivenExtra = input.drivenWheels.length > 0 ? drivenExtra / input.drivenWheels.length : 0;
  const maxSink = SURFACE_TYRE.maxSinkShare * input.radius;
  return {
    rollingResistance: input.baseRollingResistance * (1 - (1 - SURFACE_TYRE.ownTrackRolling) * (ownTrackWheels / count))
      + SURFACE_TYRE.bulldoze * (bulldoze / count),
    gripFactor: 1 - SURFACE_TYRE.tractionLossAtMax * Math.min(1, meanDrivenExtra / maxSink),
  };
}

/**
 * Signed body slip angle, rad: how far the flat velocity points away from the nose. Its sign is the
 * sign of the sideways velocity `velocity.x * nose.z - velocity.z * nose.x`.
 */
export function bodySlipOf(velocity: Vector3, nose: Vector3, forwardSpeed: number): number {
  const sideways = velocity.x * nose.z - velocity.z * nose.x;
  return Math.atan2(sideways, Math.max(Math.abs(forwardSpeed), 0.5));
}

/**
 * Steer target with the counter-steer assist: when the body slides more than a few degrees, the
 * front wheels turn toward the slide, the way caster turns a released wheel. `bodySlip` comes from
 * bodySlipOf; the sign here was measured, the other one doubles the slide.
 */
export function countersteer(steerTarget: number, bodySlip: number, flatSpeed: number, maxSteer: number): number {
  if (flatSpeed <= SURFACE_TYRE.countersteerMinSpeed) return steerTarget;
  const beyond = Math.max(0, Math.abs(bodySlip) - SURFACE_TYRE.countersteerFreeSlip);
  if (beyond === 0) return steerTarget;
  const steered = steerTarget - SURFACE_TYRE.countersteerGain * Math.sign(bodySlip) * beyond;
  return Math.max(-maxSteer, Math.min(maxSteer, steered));
}
