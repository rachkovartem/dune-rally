// shared/drivetrain.ts
// Longitudinal model of a real car's engine and gearbox: pure functions, no Rapier, so the same
// numbers drive the local car, the server copy and the bench, and the rpm/gear can feed engine sound.

export const STANDARD_GRAVITY = 9.81;
export const AIR_DENSITY = 1.225;

const RAD_PER_SEC_TO_RPM = 60 / (2 * Math.PI);
// Below this forward speed a pedal changes its meaning: brake becomes reverse, gas stops a reverse roll.
export const PEDAL_SWITCH_SPEED = 0.5;
// Below this speed rolling resistance acts like static friction: it resists but never pushes.
const STANDSTILL_SPEED = 0.05;
// The governor fades the drive force out over this band above the top speed instead of cutting it.
const LIMITER_BAND = 0.25;

export interface TorquePoint {
  rpm: number;
  torque: number;
}

export interface EngineSpec {
  idleRpm: number;
  cutOffRpm: number;
  /** Full-throttle torque in Nm, sorted by rpm, starting at 0 rpm. */
  torqueCurve: readonly TorquePoint[];
}

/** Continuously variable transmission: the ratio slides so the engine climbs to one rpm and holds it. */
export interface CvtSpec {
  kind: 'cvt';
  lowRatio: number;
  highRatio: number;
  /** Engine rpm at full throttle from a standstill. */
  launchRpm: number;
  /** Engine rpm the belt holds at full throttle once the car is fast enough. */
  holdRpm: number;
  /** Speed (m/s) at which the full-throttle rpm reaches holdRpm. */
  holdRpmSpeed: number;
  rpmRiseRate: number;
  rpmFallRate: number;
}

/** Stepped automatic: fixed ratios, rpm drops on every upshift. */
export interface AutomaticSpec {
  kind: 'automatic';
  ratios: readonly number[];
  upshiftRpm: number;
  /** Under throttle the box drops a gear when the lower gear would still turn below this rpm. */
  kickdownRpm: number;
  /** Without throttle the box drops a gear when the engine falls below this rpm. */
  coastDownshiftRpm: number;
  shiftSeconds: number;
  /** Share of the torque that reaches the wheels while a shift is in progress. */
  shiftTorqueFactor: number;
  /** Engine rpm the torque converter allows at full throttle before it couples. */
  launchRpm: number;
  rpmRiseRate: number;
  rpmFallRate: number;
}

export interface DrivetrainSpec {
  engine: EngineSpec;
  gearbox: CvtSpec | AutomaticSpec;
  finalDrive: number;
  reverseRatio: number;
  converter: { stallMultiplier: number; couplingSpeedRatio: number };
  efficiency: number;
  /** Rolling radius of the real tyre in metres. */
  tyreRadius: number;
  /** Under power the engine, gears and wheels spin up with the car: mass × this factor while driving. */
  rotatingMassFactor: number;
  /** Governed top speed, m/s. */
  topSpeed: number;
  reverseTopSpeed: number;
  /** Drag of the closed throttle while coasting, N. */
  engineBrakeForce: number;
  dragCoefficient: number;
  frontalArea: number;
  /** Tyre friction coefficient on the best surface (grip 1). */
  tyrePeakFriction: number;
}

export type DriveDirection = 1 | -1;

export interface DrivetrainState {
  rpm: number;
  /** -1 = reverse, 1..n = forward gear (a CVT is always in 1 when going forward). */
  gear: number;
  /** Current gearbox ratio, final drive not included. */
  ratio: number;
  /** Seconds left in the current shift; 0 when no shift is running. */
  shiftTimer: number;
}

export interface PedalIntent {
  /** 0..1 share of full throttle sent to the engine. */
  drive: number;
  /** 0..1 share of full braking. */
  brake: number;
  direction: DriveDirection;
}

export function createDrivetrainState(spec: DrivetrainSpec): DrivetrainState {
  const ratio = spec.gearbox.kind === 'cvt' ? spec.gearbox.lowRatio : spec.gearbox.ratios[0];
  return { rpm: spec.engine.idleRpm, gear: 1, ratio, shiftTimer: 0 };
}

/** Full-throttle engine torque (Nm) at an rpm, linear between the curve points; 0 at or above cut-off. */
export function engineTorqueAt(engine: EngineSpec, rpm: number): number {
  if (!(rpm >= 0) || rpm >= engine.cutOffRpm) return 0;
  const curve = engine.torqueCurve;
  for (let index = 1; index < curve.length; index++) {
    const upper = curve[index];
    if (rpm <= upper.rpm) {
      const lower = curve[index - 1];
      return lower.torque + ((upper.torque - lower.torque) * (rpm - lower.rpm)) / (upper.rpm - lower.rpm);
    }
  }
  return 0;
}

/**
 * Turns the two pedals into what the car should do. Like an automatic car game: holding brake
 * at a standstill engages reverse, and gas while rolling backwards brakes first.
 */
export function pedalIntent(throttle: number, brake: number, forwardSpeed: number): PedalIntent {
  if (throttle > 0 && brake > 0) return { drive: 0, brake, direction: forwardSpeed < -PEDAL_SWITCH_SPEED ? -1 : 1 };
  if (throttle > 0) {
    if (forwardSpeed < -PEDAL_SWITCH_SPEED) return { drive: 0, brake: throttle, direction: -1 };
    return { drive: throttle, brake: 0, direction: 1 };
  }
  if (brake > 0) {
    if (forwardSpeed > PEDAL_SWITCH_SPEED) return { drive: 0, brake, direction: 1 };
    return { drive: brake, brake: 0, direction: -1 };
  }
  return { drive: 0, brake: 0, direction: forwardSpeed < -PEDAL_SWITCH_SPEED ? -1 : 1 };
}

export function wheelRpmAt(spec: DrivetrainSpec, forwardSpeed: number): number {
  return (Math.abs(forwardSpeed) / spec.tyreRadius) * RAD_PER_SEC_TO_RPM;
}

const approach = (value: number, target: number, riseRate: number, fallRate: number, dt: number): number =>
  target > value ? Math.min(target, value + riseRate * dt) : Math.max(target, value - fallRate * dt);

// While the converter slips the engine runs between idle and the launch rpm, by throttle share.
const slippingRpm = (engine: EngineSpec, launchRpm: number, drive: number): number =>
  engine.idleRpm + (launchRpm - engine.idleRpm) * drive;

/** Advances the engine speed, the gear and the ratio by one step. Returns a new state. */
export function stepGearbox(
  spec: DrivetrainSpec,
  state: DrivetrainState,
  intent: PedalIntent,
  forwardSpeed: number,
  dt: number,
): DrivetrainState {
  const gearbox = spec.gearbox;
  const wheelRpm = wheelRpmAt(spec, forwardSpeed);
  const rise = gearbox.rpmRiseRate;
  const fall = gearbox.rpmFallRate;

  if (intent.direction < 0) {
    const coupledRpm = wheelRpm * spec.reverseRatio * spec.finalDrive;
    const target = Math.max(coupledRpm, slippingRpm(spec.engine, gearbox.launchRpm, intent.drive));
    const rpm = Math.max(approach(state.rpm, target, rise, fall, dt), coupledRpm, spec.engine.idleRpm);
    return { rpm, gear: -1, ratio: spec.reverseRatio, shiftTimer: 0 };
  }

  if (gearbox.kind === 'cvt') {
    const tallestRpm = wheelRpm * gearbox.highRatio * spec.finalDrive;
    let target: number;
    if (intent.drive > 0) {
      const blend = Math.min(1, Math.abs(forwardSpeed) / gearbox.holdRpmSpeed);
      const fullThrottleRpm = gearbox.launchRpm + (gearbox.holdRpm - gearbox.launchRpm) * blend * (2 - blend);
      target = spec.engine.idleRpm + (fullThrottleRpm - spec.engine.idleRpm) * intent.drive;
    } else {
      target = Math.max(spec.engine.idleRpm, tallestRpm);
    }
    // The belt cannot go taller than its top ratio, so at speed the wheels drag the engine up.
    const rpm = Math.max(approach(state.rpm, target, rise, fall, dt), tallestRpm, spec.engine.idleRpm);
    const ratio = wheelRpm > 1
      ? Math.min(gearbox.lowRatio, Math.max(gearbox.highRatio, rpm / (wheelRpm * spec.finalDrive)))
      : gearbox.lowRatio;
    return { rpm, gear: 1, ratio, shiftTimer: 0 };
  }

  const topGear = gearbox.ratios.length;
  let gear = state.gear < 1 ? 1 : Math.min(state.gear, topGear);
  let shiftTimer = Math.max(0, state.shiftTimer - dt);
  const coupledIn = (candidate: number): number => wheelRpm * gearbox.ratios[candidate - 1] * spec.finalDrive;
  if (shiftTimer === 0) {
    if (gear < topGear && coupledIn(gear) >= gearbox.upshiftRpm) {
      gear += 1;
      shiftTimer = gearbox.shiftSeconds;
    } else if (gear > 1) {
      const wantsLower = intent.drive > 0
        ? coupledIn(gear - 1) < gearbox.kickdownRpm
        : coupledIn(gear) < gearbox.coastDownshiftRpm;
      if (wantsLower) {
        gear -= 1;
        shiftTimer = gearbox.shiftSeconds;
      }
    }
  }
  const coupledRpm = coupledIn(gear);
  const target = intent.drive > 0
    ? Math.max(coupledRpm, slippingRpm(spec.engine, gearbox.launchRpm, intent.drive))
    : Math.max(coupledRpm, spec.engine.idleRpm);
  const rpm = Math.max(approach(state.rpm, target, rise, fall, dt), coupledRpm, spec.engine.idleRpm);
  return { rpm, gear, ratio: gearbox.ratios[gear - 1], shiftTimer };
}

/** Torque converter multiplication: full at stall, 1 once the output turns near engine speed. */
export function converterMultiplier(spec: DrivetrainSpec, engineRpm: number, coupledRpm: number): number {
  if (!(engineRpm > 0)) return 1;
  const speedRatio = Math.min(1, coupledRpm / engineRpm);
  const { stallMultiplier, couplingSpeedRatio } = spec.converter;
  return stallMultiplier - (stallMultiplier - 1) * Math.min(1, speedRatio / couplingSpeedRatio);
}

/**
 * Engine force at the tyres (N), signed: positive pushes toward the nose. Not yet limited by
 * traction — see longitudinalForce.
 */
export function driveForce(
  spec: DrivetrainSpec,
  state: DrivetrainState,
  intent: PedalIntent,
  forwardSpeed: number,
): number {
  if (intent.drive <= 0) return 0;
  const overallRatio = state.ratio * spec.finalDrive;
  const coupledRpm = wheelRpmAt(spec, forwardSpeed) * overallRatio;
  const shifting = spec.gearbox.kind === 'automatic' && state.shiftTimer > 0 ? spec.gearbox.shiftTorqueFactor : 1;
  const wheelTorque = engineTorqueAt(spec.engine, state.rpm) * intent.drive * shifting
    * overallRatio * converterMultiplier(spec, state.rpm, coupledRpm) * spec.efficiency;
  const limit = intent.direction > 0 ? spec.topSpeed : spec.reverseTopSpeed;
  const governor = Math.min(1, Math.max(0, (limit + LIMITER_BAND - Math.abs(forwardSpeed)) / LIMITER_BAND));
  return (intent.direction * wheelTorque * governor) / spec.tyreRadius;
}

/**
 * The tyre force to hand to a rigid body of plain mass so that, while driving, the car
 * accelerates as if it had mass × rotatingMassFactor. Top speed is unchanged: at a steady speed
 * the net force is 0 either way. `aeroAlongNose` is the signed air drag along the nose.
 */
export function withRotatingMass(
  spec: DrivetrainSpec,
  tyreForce: number,
  aeroAlongNose: number,
  intent: PedalIntent,
): number {
  if (intent.drive <= 0) return tyreForce;
  return (tyreForce + aeroAlongNose) / spec.rotatingMassFactor - aeroAlongNose;
}

export function aeroDragForce(spec: DrivetrainSpec, speed: number): number {
  return 0.5 * AIR_DENSITY * spec.dragCoefficient * spec.frontalArea * speed * speed;
}

export interface LongitudinalInput {
  driveForce: number;
  intent: PedalIntent;
  forwardSpeed: number;
  /** Terrain grip of the ground under the car, (0, 1]. */
  grip: number;
  rollingResistance: number;
  /** Weight carried by the wheels that touch the ground, N. */
  normalForce: number;
  brakeForce: number;
  mass: number;
  dt: number;
}

/**
 * Net tyre force along the car (N, positive toward the nose): drive limited by traction, minus
 * brakes, rolling resistance and engine braking. Resistance can stop the car but never reverse it.
 */
export function longitudinalForce(spec: DrivetrainSpec, input: LongitudinalInput): number {
  const traction = spec.tyrePeakFriction * input.grip * input.normalForce;
  const drive = Math.max(-traction, Math.min(traction, input.driveForce));
  const rolling = input.rollingResistance * input.normalForce;
  const speed = input.forwardSpeed;

  if (Math.abs(speed) < STANDSTILL_SPEED) {
    return Math.abs(drive) <= rolling ? 0 : drive - Math.sign(drive) * rolling;
  }
  const braking = Math.min(input.intent.brake * input.brakeForce, traction);
  const engineBrake = input.intent.drive > 0 ? 0 : spec.engineBrakeForce;
  let resist = braking + rolling + engineBrake;
  if (drive === 0) resist = Math.min(resist, (input.mass * Math.abs(speed)) / input.dt);
  return drive - Math.sign(speed) * resist;
}
