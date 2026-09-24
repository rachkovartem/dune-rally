// shared/carBench.ts
// Drives one car on a flat in-memory Rapier world and measures it: the numbers behind the car
// comparison promises (acceleration, top speed, braking, turning, roll, rollover recovery).
// Call RAPIER.init() once before any function here.
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleConfig } from '../src/vehicle/vehicleConfig';
import type { InputMsg } from './protocol';
import { createVehiclePhysics, forwardAxisOf, RESET_LIFT, type Quaternion, type VehiclePhysics } from './vehiclePhysics';
import { WORLD_GRAVITY } from './drivetrain';

// Same step as the game's client and server worlds.
const BENCH_STEP = 1 / 60;
const SETTLE_SECONDS = 1.5;
const GROUND_HALF_SIZE = 5000;
const KMH = 1 / 3.6;

export interface BenchCar {
  world: RAPIER.World;
  vehicle: VehiclePhysics;
  /** Seconds driven since the car settled. */
  time: number;
}

/** A settled car standing on a flat, endless ground, heading +Z. */
export function createBenchCar(config: VehicleConfig): BenchCar {
  const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
  world.timestep = BENCH_STEP;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(GROUND_HALF_SIZE, 0.5, GROUND_HALF_SIZE).setTranslation(0, -0.5, 0),
    ground,
  );
  const vehicle = createVehiclePhysics(world, { x: 0, y: 2.5, z: 0 }, config);
  const car: BenchCar = { world, vehicle, time: 0 };
  for (let step = 0; step < SETTLE_SECONDS / BENCH_STEP; step++) stepBenchCar(car, IDLE, 1);
  car.time = 0;
  return car;
}

const IDLE: InputMsg = { throttle: 0, brake: 0, steer: 0 };

export function stepBenchCar(car: BenchCar, input: InputMsg, grip: number): void {
  car.vehicle.applyInput(input, grip);
  car.world.step();
  car.vehicle.update(car.world.timestep);
  car.time += car.world.timestep;
}

export function yawOf(rotation: Quaternion): number {
  const forward = forwardAxisOf(rotation);
  return Math.atan2(forward.x, forward.z);
}

/** Body roll around the car's own length, radians; positive = right side up. */
export function rollOf(rotation: Quaternion): number {
  const { x, y, z, w } = rotation;
  const rightUp = 2 * (x * y + w * z);
  return Math.asin(Math.max(-1, Math.min(1, rightUp)));
}

export interface SpeedSample {
  time: number;
  /** Forward speed, m/s. */
  speed: number;
  rpm: number;
  gear: number;
}

export interface StraightLineResult {
  samples: readonly SpeedSample[];
  /** Seconds to 60 km/h, or null when not reached. */
  timeTo60: number | null;
  timeTo100: number | null;
  topSpeed: number;
}

/** Full throttle from a standstill for `seconds`. */
export function runStraightLine(config: VehicleConfig, grip: number, seconds: number): StraightLineResult {
  const car = createBenchCar(config);
  const samples: SpeedSample[] = [];
  let timeTo60: number | null = null;
  let timeTo100: number | null = null;
  let topSpeed = 0;
  while (car.time < seconds - 1e-9) {
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, grip);
    const speed = car.vehicle.forwardSpeed();
    const drivetrain = car.vehicle.drivetrain();
    samples.push({ time: car.time, speed, rpm: drivetrain.rpm, gear: drivetrain.gear });
    if (timeTo60 === null && speed >= 60 * KMH) timeTo60 = car.time;
    if (timeTo100 === null && speed >= 100 * KMH) timeTo100 = car.time;
    topSpeed = Math.max(topSpeed, speed);
  }
  return { samples, timeTo60, timeTo100, topSpeed };
}

/** Forward speed at the sample nearest to `time`. Throws when the run did not last that long. */
export function speedAt(result: StraightLineResult, time: number): number {
  const last = result.samples[result.samples.length - 1];
  if (!last || last.time < time - BENCH_STEP) {
    throw new Error(`speedAt: the run ended at ${last?.time ?? 0}s, before ${time}s`);
  }
  const index = Math.min(result.samples.length - 1, Math.max(0, Math.round(time / BENCH_STEP) - 1));
  return result.samples[index].speed;
}

/** Accelerates up to `fromSpeed`, then holds full brake until the car stops. */
export function runBraking(
  config: VehicleConfig,
  grip: number,
  fromSpeed: number,
): { distance: number; seconds: number } {
  const car = createBenchCar(config);
  while (car.vehicle.forwardSpeed() < fromSpeed) {
    if (car.time > 120) throw new Error(`runBraking: the car never reached ${fromSpeed} m/s`);
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, grip);
  }
  const start = car.vehicle.body.translation();
  const startTime = car.time;
  while (car.vehicle.forwardSpeed() > 0.3) {
    if (car.time - startTime > 60) throw new Error('runBraking: the car did not stop within 60 s');
    stepBenchCar(car, { throttle: 0, brake: 1, steer: 0 }, grip);
  }
  const end = car.vehicle.body.translation();
  return { distance: Math.hypot(end.x - start.x, end.z - start.z), seconds: car.time - startTime };
}

export interface TurnOptions {
  /** Straight-line speed before steering starts; 0 = steer from a standstill with full throttle. */
  entrySpeed: number;
  seconds: number;
  /** -1 = full left (A), +1 = full right (D). */
  steer: number;
  grip: number;
}

export interface TurnResult {
  /** Signed, unwrapped heading change, radians; positive = turned left. */
  headingChange: number;
  maxRoll: number;
  flipped: boolean;
  endSpeed: number;
}

/** Full lock for `seconds`; with an entry speed the throttle holds that speed during the turn. */
export function runTurn(config: VehicleConfig, options: TurnOptions): TurnResult {
  const car = createBenchCar(config);
  while (car.vehicle.forwardSpeed() < options.entrySpeed) {
    if (car.time > 120) throw new Error(`runTurn: the car never reached ${options.entrySpeed} m/s`);
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, options.grip);
  }
  const startTime = car.time;
  let previousYaw = yawOf(car.vehicle.body.rotation());
  let headingChange = 0;
  let maxRoll = 0;
  let flipped = false;
  while (car.time - startTime < options.seconds - 1e-9) {
    const holdSpeed = options.entrySpeed > 0;
    const throttle = !holdSpeed || car.vehicle.forwardSpeed() < options.entrySpeed ? 1 : 0;
    stepBenchCar(car, { throttle, brake: 0, steer: options.steer }, options.grip);
    const rotation = car.vehicle.body.rotation();
    const yaw = yawOf(rotation);
    let delta = yaw - previousYaw;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    headingChange += delta;
    previousYaw = yaw;
    maxRoll = Math.max(maxRoll, Math.abs(rollOf(rotation)));
    if (1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z) < 0) flipped = true;
  }
  return { headingChange, maxRoll, flipped, endSpeed: car.vehicle.forwardSpeed() };
}

export interface RolloverResult {
  /** Most wheels touching the ground at any moment while the car lay on its roof. */
  maxWheelsInContactUpsideDown: number;
  speedAfterLanding: number;
  speedAfterThreeSeconds: number;
  headingBeforeReset: number;
  headingAfterReset: number;
  /** Distance driven along the nose in 3 s of throttle after the reset; > 0 means forward. */
  progressAlongNose: number;
}

/**
 * Drops the car on its roof while it slides at `slideSpeed`, holds full throttle for 3 s, then
 * resets it upright and drives 3 s.
 */
export function runRollover(config: VehicleConfig, heading: number, slideSpeed: number): RolloverResult {
  const car = createBenchCar(config);
  const body = car.vehicle.body;
  const half = heading / 2;
  // Yaw by `heading`, then roll 180° around the car's own length.
  body.setRotation({ x: Math.sin(half), y: 0, z: Math.cos(half), w: 0 }, true);
  const position = body.translation();
  body.setTranslation({ x: position.x, y: position.y + 1.5, z: position.z }, true);
  body.setLinvel({ x: Math.sin(heading) * slideSpeed, y: 0, z: Math.cos(heading) * slideSpeed }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);

  const flatSpeed = (): number => Math.hypot(body.linvel().x, body.linvel().z);
  const full: InputMsg = { throttle: 1, brake: 0, steer: 0 };
  let maxWheelsInContactUpsideDown = 0;
  let speedAfterLanding = 0;
  const startTime = car.time;
  while (car.time - startTime < 3) {
    stepBenchCar(car, full, 1);
    maxWheelsInContactUpsideDown = Math.max(maxWheelsInContactUpsideDown, car.vehicle.wheelsInContact());
    if (car.time - startTime <= 0.5) speedAfterLanding = flatSpeed();
  }
  const speedAfterThreeSeconds = flatSpeed();
  const headingBeforeReset = yawOf(body.rotation());

  car.vehicle.resetUpright(RESET_LIFT);
  const headingAfterReset = yawOf(body.rotation());
  for (let step = 0; step < SETTLE_SECONDS / BENCH_STEP; step++) stepBenchCar(car, IDLE, 1);
  const before = body.translation();
  const nose = forwardAxisOf(body.rotation());
  const driveStart = car.time;
  while (car.time - driveStart < 3) stepBenchCar(car, full, 1);
  const after = body.translation();
  const progressAlongNose = (after.x - before.x) * nose.x + (after.z - before.z) * nose.z;

  return {
    maxWheelsInContactUpsideDown,
    speedAfterLanding,
    speedAfterThreeSeconds,
    headingBeforeReset,
    headingAfterReset,
    progressAlongNose,
  };
}
