// shared/carBench.ts
// Drives one car on a flat in-memory Rapier world and measures it: the numbers behind the car
// comparison promises (acceleration, top speed, braking, turning, roll, rollover recovery).
// Call RAPIER.init() once before any function here.
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleConfig } from '../src/vehicle/vehicleConfig';
import type { InputMsg } from './protocol';
import { createVehiclePhysics, forwardAxisOf, RESET_LIFT, upAxisOf, type Quaternion, type VehiclePhysics } from './vehiclePhysics';
import { WORLD_GRAVITY } from './drivetrain';
import { FULL_GRIP, type SurfaceGround } from './terrainGrip';
import { bodySlipOf, SURFACE_TYRE } from './surfaceTyre';

// Same step as the game's client and server worlds.
const BENCH_STEP = 1 / 60;
const SETTLE_SECONDS = 3;
const GROUND_HALF_SIZE = 5000;
const KMH = 1 / 3.6;

export interface BenchCar {
  world: RAPIER.World;
  vehicle: VehiclePhysics;
  /** Seconds driven since the car settled. */
  time: number;
}

function createBenchWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
  world.timestep = BENCH_STEP;
  return world;
}

function addFlatGround(world: RAPIER.World): void {
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(GROUND_HALF_SIZE, 0.5, GROUND_HALF_SIZE).setTranslation(0, -0.5, 0),
    ground,
  );
}

/** A settled car standing on a flat, endless ground, heading +Z. */
export function createBenchCar(config: VehicleConfig): BenchCar {
  const world = createBenchWorld();
  addFlatGround(world);
  const vehicle = createVehiclePhysics(world, { x: 0, y: 2.5, z: 0 }, config);
  const car: BenchCar = { world, vehicle, time: 0 };
  for (let step = 0; step < SETTLE_SECONDS / BENCH_STEP; step++) stepBenchCar(car, IDLE, FULL_GRIP);
  car.time = 0;
  return car;
}

const IDLE: InputMsg = { throttle: 0, brake: 0, steer: 0 };

export function stepBenchCar(car: BenchCar, input: InputMsg, ground: SurfaceGround): void {
  car.vehicle.applyInput(input, ground);
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

/**
 * World height of the lowest corner of the chassis box. `centre` is the box's own world centre
 * (the collider's translation, not the body's), `rotation` the body's rotation.
 */
export function chassisBottomHeight(
  centre: { x: number; y: number; z: number },
  rotation: Quaternion,
  chassis: Pick<VehicleConfig['chassis'], 'hx' | 'hy' | 'hz'>,
): number {
  const rightUp = 2 * (rotation.x * rotation.y + rotation.w * rotation.z);
  const reach = Math.abs(rightUp) * chassis.hx
    + Math.abs(upAxisOf(rotation).y) * chassis.hy
    + Math.abs(forwardAxisOf(rotation).y) * chassis.hz;
  return centre.y - reach;
}

/** Lowest point of a car's chassis collider in world space, metres. */
export function chassisBottomOf(vehicle: VehiclePhysics, config: VehicleConfig): number {
  if (vehicle.body.numColliders() < 1) throw new Error('chassisBottomOf: the car body has no collider');
  return chassisBottomHeight(vehicle.body.collider(0).translation(), vehicle.body.rotation(), config.chassis);
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
export function runStraightLine(config: VehicleConfig, ground: SurfaceGround, seconds: number): StraightLineResult {
  const car = createBenchCar(config);
  const samples: SpeedSample[] = [];
  let timeTo60: number | null = null;
  let timeTo100: number | null = null;
  let topSpeed = 0;
  while (car.time < seconds - 1e-9) {
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, ground);
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
  ground: SurfaceGround,
  fromSpeed: number,
): { distance: number; seconds: number } {
  const car = createBenchCar(config);
  while (car.vehicle.forwardSpeed() < fromSpeed) {
    if (car.time > 120) throw new Error(`runBraking: the car never reached ${fromSpeed} m/s`);
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, ground);
  }
  const start = car.vehicle.body.translation();
  const startTime = car.time;
  while (car.vehicle.forwardSpeed() > 0.3) {
    if (car.time - startTime > 60) throw new Error('runBraking: the car did not stop within 60 s');
    stepBenchCar(car, { throttle: 0, brake: 1, steer: 0 }, ground);
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
  ground: SurfaceGround;
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
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, options.ground);
  }
  const startTime = car.time;
  let previousYaw = yawOf(car.vehicle.body.rotation());
  let headingChange = 0;
  let maxRoll = 0;
  let flipped = false;
  while (car.time - startTime < options.seconds - 1e-9) {
    const holdSpeed = options.entrySpeed > 0;
    const throttle = !holdSpeed || car.vehicle.forwardSpeed() < options.entrySpeed ? 1 : 0;
    stepBenchCar(car, { throttle, brake: 0, steer: options.steer }, options.ground);
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
    stepBenchCar(car, full, FULL_GRIP);
    maxWheelsInContactUpsideDown = Math.max(maxWheelsInContactUpsideDown, car.vehicle.wheelsInContact());
    if (car.time - startTime <= 0.5) speedAfterLanding = flatSpeed();
  }
  const speedAfterThreeSeconds = flatSpeed();
  const headingBeforeReset = yawOf(body.rotation());

  car.vehicle.resetUpright(RESET_LIFT);
  const headingAfterReset = yawOf(body.rotation());
  for (let step = 0; step < SETTLE_SECONDS / BENCH_STEP; step++) stepBenchCar(car, IDLE, FULL_GRIP);
  const before = body.translation();
  const nose = forwardAxisOf(body.rotation());
  const driveStart = car.time;
  while (car.time - driveStart < 3) stepBenchCar(car, full, FULL_GRIP);
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

export interface GroundStretch {
  /** Metres of this ground along the line. */
  length: number;
  ground: SurfaceGround;
}

export interface GroundLineResult {
  /** Seconds to cover the whole line, or null when the time limit ran out first. */
  seconds: number | null;
  /** Forward speed at the end of each stretch, m/s (0 for a stretch never reached). */
  speedAtEndOf: readonly number[];
  topSpeed: number;
}

/**
 * Full throttle from a standstill along a straight line whose ground changes stretch by stretch,
 * like Die Myl: gravel first, then the salt.
 */
export function runGroundLine(config: VehicleConfig, stretches: readonly GroundStretch[], timeLimit: number): GroundLineResult {
  if (stretches.length === 0) throw new Error('runGroundLine: no ground to drive on');
  const car = createBenchCar(config);
  const start = car.vehicle.body.translation();
  const ends: number[] = [];
  let total = 0;
  for (const stretch of stretches) {
    total += stretch.length;
    ends.push(total);
  }
  const speedAtEndOf = stretches.map(() => 0);
  let stretchIndex = 0;
  let topSpeed = 0;
  while (car.time < timeLimit) {
    const position = car.vehicle.body.translation();
    const travelled = Math.hypot(position.x - start.x, position.z - start.z);
    while (stretchIndex < stretches.length && travelled >= ends[stretchIndex]) {
      speedAtEndOf[stretchIndex] = car.vehicle.forwardSpeed();
      stretchIndex++;
    }
    if (stretchIndex >= stretches.length) return { seconds: car.time, speedAtEndOf, topSpeed };
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, stretches[stretchIndex].ground);
    topSpeed = Math.max(topSpeed, car.vehicle.forwardSpeed());
  }
  return { seconds: null, speedAtEndOf, topSpeed };
}

/** Holds a forward speed with full throttle below it and none above it. */
function throttleToHold(car: BenchCar, speed: number): number {
  return car.vehicle.forwardSpeed() < speed ? 1 : 0;
}

const isUpsideDown = (rotation: Quaternion): boolean => 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z) < 0;

// Road profile of a crest across +Z: a concave arc from flat into a straight ramp, a convex arc of
// the asked radius over the top, and the same shape down. Heights in metres at a distance z.
const CREST_RAMP_ANGLE = (10 * Math.PI) / 180;
const CREST_RAMP_LENGTH = 15;
const CREST_START_Z = 600;
const CREST_SAMPLE_STEP = 0.25;
const CREST_HALF_WIDTH = 20;

interface CrestProfile {
  heightAt(z: number): number;
  /** Where the convex arc over the top starts and ends. */
  convexStartZ: number;
  convexEndZ: number;
  endZ: number;
}

function crestProfile(radius: number): CrestProfile {
  const angle = CREST_RAMP_ANGLE;
  // The concave foot uses the same radius as the crest, so the shape is symmetric in curvature.
  const arcRun = radius * Math.sin(angle);
  const arcRise = radius * (1 - Math.cos(angle));
  const rampRun = CREST_RAMP_LENGTH * Math.cos(angle);
  const rampRise = CREST_RAMP_LENGTH * Math.sin(angle);
  const footEnd = CREST_START_Z + arcRun;
  const rampEnd = footEnd + rampRun;
  const top = rampEnd + arcRun;
  const topHeight = arcRise + rampRise + arcRise;
  const halfLength = top - CREST_START_Z;
  const risingHeight = (distance: number): number => {
    if (distance <= 0) return 0;
    const z = CREST_START_Z + distance;
    if (z <= footEnd) return radius - Math.sqrt(radius * radius - distance * distance);
    if (z <= rampEnd) return arcRise + (z - footEnd) * Math.tan(angle);
    const fromTop = Math.min(radius, top - z);
    return topHeight - (radius - Math.sqrt(radius * radius - fromTop * fromTop));
  };
  return {
    heightAt(z: number): number {
      const distance = z - CREST_START_Z;
      if (distance <= halfLength) return risingHeight(distance);
      return risingHeight(Math.max(0, 2 * halfLength - distance));
    },
    convexStartZ: rampEnd,
    convexEndZ: top + arcRun,
    endZ: CREST_START_Z + 2 * halfLength,
  };
}

function addProfileGround(world: RAPIER.World, heightAt: (z: number) => number, fromZ: number, toZ: number): RAPIER.Collider {
  const vertices: number[] = [];
  const indices: number[] = [];
  const rows = Math.ceil((toZ - fromZ) / CREST_SAMPLE_STEP);
  for (let row = 0; row <= rows; row++) {
    const z = fromZ + row * CREST_SAMPLE_STEP;
    const y = heightAt(z);
    vertices.push(-CREST_HALF_WIDTH, y, z, CREST_HALF_WIDTH, y, z);
    if (row > 0) {
      const base = (row - 1) * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  return world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)), ground);
}

const HEIGHTFIELD_COLUMNS = 4;

/**
 * A ground profile across +Z as a Rapier heightfield, like the game's terrain: a fast car body
 * that touches a steep face is pushed out of it, where a thin trimesh can throw it back.
 */
function addHeightfieldGround(world: RAPIER.World, heightAt: (z: number) => number, fromZ: number, toZ: number): RAPIER.Collider {
  const rows = Math.ceil((toZ - fromZ) / CREST_SAMPLE_STEP);
  const length = rows * CREST_SAMPLE_STEP;
  const heights = new Float32Array((rows + 1) * (HEIGHTFIELD_COLUMNS + 1));
  for (let column = 0; column <= HEIGHTFIELD_COLUMNS; column++) {
    for (let row = 0; row <= rows; row++) heights[column * (rows + 1) + row] = heightAt(fromZ + row * CREST_SAMPLE_STEP);
  }
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, fromZ + length / 2));
  return world.createCollider(
    RAPIER.ColliderDesc.heightfield(rows, HEIGHTFIELD_COLUMNS, heights, { x: 2 * CREST_HALF_WIDTH, y: 1, z: length }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES),
    ground,
  );
}

export interface CrestResult {
  /** Fewest wheels touching the ground at any step while the car crossed the convex top. */
  minWheelsInContact: number;
  /** Seconds with no wheel on the ground over the whole crest. */
  airSeconds: number;
  flipped: boolean;
}

/**
 * Drives straight at `speed` over a crest whose top is a circular arc of `crestRadius` (10° ramps
 * each side). The throttle holds the speed on the way up, so the car arrives at the top near it.
 */
export function runCrest(config: VehicleConfig, crestRadius: number, speed: number): CrestResult {
  const profile = crestProfile(crestRadius);
  const world = createBenchWorld();
  addProfileGround(world, profile.heightAt, -50, profile.endZ + 400);
  const vehicle = createVehiclePhysics(world, { x: 0, y: 2.5, z: 0 }, config);
  const car: BenchCar = { world, vehicle, time: 0 };
  for (let step = 0; step < SETTLE_SECONDS / BENCH_STEP; step++) stepBenchCar(car, IDLE, FULL_GRIP);
  while (vehicle.forwardSpeed() < speed) {
    if (car.time > 120 || vehicle.body.translation().z > CREST_START_Z) {
      throw new Error(`runCrest: the car did not reach ${speed} m/s before the crest`);
    }
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, FULL_GRIP);
  }
  let minWheelsInContact = config.wheel.positions.length;
  let airSeconds = 0;
  let flipped = false;
  const startTime = car.time;
  while (vehicle.body.translation().z < profile.endZ + 60) {
    if (car.time - startTime > 60) throw new Error('runCrest: the car did not cross the crest within 60 s');
    stepBenchCar(car, { throttle: throttleToHold(car, speed), brake: 0, steer: 0 }, FULL_GRIP);
    const z = vehicle.body.translation().z;
    const contacts = vehicle.wheelsInContact();
    if (z >= profile.convexStartZ && z <= profile.convexEndZ) minWheelsInContact = Math.min(minWheelsInContact, contacts);
    if (contacts === 0 && z >= CREST_START_Z) airSeconds += BENCH_STEP;
    if (isUpsideDown(vehicle.body.rotation())) flipped = true;
  }
  return { minWheelsInContact, airSeconds, flipped };
}

const HILL_RISE = 12;
// The foot and the top of the slope are rounded like a real dune, so a car with a real belly
// clearance does not hang on a sharp edge that no dune has.
const HILL_ROUNDING_RADIUS = 8;

/** Height of the bench hill at `z`: flat, a rounded foot, the slope, a rounded top, flat again. */
function hillHeightAt(slope: number, z: number): number {
  const angle = Math.atan(slope);
  const topZ = HILL_RISE / slope;
  const tangent = HILL_ROUNDING_RADIUS * Math.tan(angle / 2);
  const radius = HILL_ROUNDING_RADIUS;
  if (z <= -tangent) return 0;
  if (z <= -tangent + radius * Math.sin(angle)) return radius - Math.sqrt(radius * radius - (z + tangent) ** 2);
  if (z >= topZ + tangent) return HILL_RISE;
  if (z >= topZ + tangent - radius * Math.sin(angle)) {
    return HILL_RISE - radius + Math.sqrt(radius * radius - (z - topZ - tangent) ** 2);
  }
  return slope * z;
}
const HILL_SECONDS = 30;

export interface HillClimbResult {
  reachedTop: boolean;
  /** Highest point the car reached, as metres of height above the foot of the slope. */
  bestProgress: number;
}

export interface HillClimbOptions {
  /** Metres of flat ground of the same kind before the foot; 0 = start standing on the slope. */
  runUp?: number;
  /** Extra driver inputs held the whole run: a drive mode, traction control off. */
  input?: Pick<InputMsg, 'driveMode' | 'tractionControl'>;
  /** Every wheel starts this deep in the ground, m (a car dug in on the slope). */
  startSink?: number;
  seconds?: number;
  /** After `afterSeconds` the driver lets go for a moment, then holds these inputs instead. */
  change?: { afterSeconds: number; input: Pick<InputMsg, 'driveMode' | 'tractionControl'> };
}

// How long the driver lets go of the pedal before a changed input (a drive mode) takes over.
const CHANGE_PAUSE_SECONDS = 0.5;

/**
 * Full throttle from a standstill up a straight slope of `slope` (rise over run, tan θ) that
 * climbs HILL_RISE metres, with the car's grip for that ground. The car starts on the slope, or
 * `runUp` metres before its foot.
 */
export function runHillClimb(config: VehicleConfig, slope: number, ground: SurfaceGround, options: HillClimbOptions = {}): HillClimbResult {
  const runUp = options.runUp ?? 0;
  const angle = Math.atan(slope);
  const world = createBenchWorld();
  const normal = { y: Math.cos(angle), z: -Math.sin(angle) };
  const tilt = { x: -Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
  const topZ = HILL_RISE / slope;
  const flatBefore = Math.max(100, runUp + 50);
  addHeightfieldGround(world, (z) => hillHeightAt(slope, z), -flatBefore, topZ + 200);

  const startAlong = 4;
  const lift = 1.2;
  const vehicle = runUp > 0
    ? createVehiclePhysics(world, { x: 0, y: lift, z: -runUp }, config)
    : createVehiclePhysics(world, {
      x: 0,
      y: startAlong * Math.sin(angle) + lift * normal.y,
      z: startAlong * Math.cos(angle) + lift * normal.z,
    }, config);
  if (runUp === 0) vehicle.body.setRotation(tilt, true);
  const car: BenchCar = { world, vehicle, time: 0 };
  const held = { ...options.input };
  if (options.startSink !== undefined) {
    // Let it land first, so the depth is not lost while it drops onto the ground.
    for (let step = 0; step < SETTLE_SECONDS / BENCH_STEP; step++) stepBenchCar(car, { ...IDLE, ...held }, ground);
    const wheels = config.wheel.positions.length;
    vehicle.setSurfaceState({
      spin: 0, spinDirection: 1, sink: new Array<number>(wheels).fill(options.startSink), digDirection: new Array<1 | -1>(wheels).fill(1),
    });
    car.time = 0;
  }
  const footHeight = 0;
  let bestProgress = 0;
  const change = options.change;
  while (car.time < (options.seconds ?? HILL_SECONDS)) {
    const changed = change !== undefined && car.time >= change.afterSeconds;
    const pausing = changed && car.time < change.afterSeconds + CHANGE_PAUSE_SECONDS;
    const input = changed ? { ...held, ...change.input } : held;
    stepBenchCar(car, { throttle: pausing ? 0 : 1, brake: 0, steer: 0, ...input }, ground);
    const position = vehicle.body.translation();
    // Height of the ground under the car's centre, so a car lying on the slope still counts.
    const groundHeight = Math.min(HILL_RISE, Math.max(footHeight, position.z * slope));
    bestProgress = Math.max(bestProgress, groundHeight);
    if (position.z > topZ + 5) return { reachedTop: true, bestProgress: HILL_RISE };
  }
  return { reachedTop: false, bestProgress };
}

export interface DropSettleResult {
  /** Seconds from the release until the body stays within 5 mm of its resting height. */
  settleSeconds: number;
  /** Highest rebound above the resting height after the first compression, metres. */
  maxBounce: number;
  /** Lowest chassis-box height above the flat ground over the whole run, metres; ≤ 0 = it touched. */
  minChassisClearance: number;
}

const SETTLE_BAND = 0.005;
const DROP_RUN_SECONDS = 5;

/** Lifts a settled car by `dropHeight`, lets it fall on flat ground and watches it come to rest. */
export function runDropSettle(config: VehicleConfig, dropHeight: number): DropSettleResult {
  const car = createBenchCar(config);
  for (let step = 0; step < SETTLE_SECONDS / BENCH_STEP; step++) stepBenchCar(car, IDLE, FULL_GRIP);
  const body = car.vehicle.body;
  const restingY = body.translation().y;
  const start = body.translation();
  body.setTranslation({ x: start.x, y: restingY + dropHeight, z: start.z }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  const releaseTime = car.time;
  let lastOutsideBand = 0;
  let compressed = false;
  let maxBounce = 0;
  let minChassisClearance = chassisBottomOf(car.vehicle, config);
  while (car.time - releaseTime < DROP_RUN_SECONDS) {
    stepBenchCar(car, IDLE, FULL_GRIP);
    minChassisClearance = Math.min(minChassisClearance, chassisBottomOf(car.vehicle, config));
    const offset = body.translation().y - restingY;
    if (offset < 0) compressed = true;
    if (compressed) maxBounce = Math.max(maxBounce, offset);
    if (Math.abs(offset) > SETTLE_BAND) lastOutsideBand = car.time - releaseTime;
  }
  return { settleSeconds: lastOutsideBand, maxBounce, minChassisClearance };
}

const RIDGE_START_Z = 40;
const RIDGE_HEIGHT = 1.5;
const RIDGE_SECONDS = 20;
// Below this forward speed the car counts as stuck on the ridge.
const RIDGE_STUCK_SPEED = 0.3;

export interface RidgeResult {
  /** The car's centre passed the far foot of the ridge within the time limit. */
  crossed: boolean;
  /** Seconds the car spent slower than RIDGE_STUCK_SPEED once it reached the ridge. */
  stuckSeconds: number;
  /** Seconds the chassis box touched the ground once the car reached the ridge: the belly scraping. */
  bellyContactSeconds: number;
}

/**
 * Drives at `speed` over a sharp ridge: a straight ramp up at `rampAngleDegrees`, a pointed top and
 * the same ramp down. A car whose belly sits lower than the top between its axles hangs on it.
 * The throttle holds the speed for RIDGE_SECONDS from the foot of the ridge.
 */
export function runRidge(config: VehicleConfig, rampAngleDegrees: number, speed: number): RidgeResult {
  const slope = Math.tan((rampAngleDegrees * Math.PI) / 180);
  const halfLength = RIDGE_HEIGHT / slope;
  const topZ = RIDGE_START_Z + halfLength;
  const endZ = topZ + halfLength;
  const heightAt = (z: number): number => Math.max(0, RIDGE_HEIGHT - Math.abs(z - topZ) * slope);
  const world = createBenchWorld();
  const ground = addProfileGround(world, heightAt, -50, endZ + 100);
  const vehicle = createVehiclePhysics(world, { x: 0, y: 2.5, z: 0 }, config);
  const chassis = vehicle.body.collider(0);
  const car: BenchCar = { world, vehicle, time: 0 };
  for (let step = 0; step < SETTLE_SECONDS / BENCH_STEP; step++) stepBenchCar(car, IDLE, FULL_GRIP);
  while (vehicle.body.translation().z < RIDGE_START_Z - frontAxleOffset(config)) {
    if (car.time > 120) throw new Error('runRidge: the car did not reach the ridge within 120 s');
    stepBenchCar(car, { throttle: throttleToHold(car, speed), brake: 0, steer: 0 }, FULL_GRIP);
  }
  const startTime = car.time;
  let stuckSeconds = 0;
  let bellyContactSeconds = 0;
  while (car.time - startTime < RIDGE_SECONDS) {
    stepBenchCar(car, { throttle: throttleToHold(car, speed), brake: 0, steer: 0 }, FULL_GRIP);
    if (vehicle.forwardSpeed() < RIDGE_STUCK_SPEED) stuckSeconds += BENCH_STEP;
    let touching = false;
    world.contactPair(chassis, ground, (manifold) => {
      if (manifold.numContacts() > 0) touching = true;
    });
    if (touching) bellyContactSeconds += BENCH_STEP;
    if (vehicle.body.translation().z > endZ) return { crossed: true, stuckSeconds, bellyContactSeconds };
  }
  return { crossed: false, stuckSeconds, bellyContactSeconds };
}

// How far ahead of the body origin the front wheels sit.
function frontAxleOffset(config: VehicleConfig): number {
  return Math.max(...config.wheel.positions.map((position) => position.z));
}

// ── surface handling (plan v3 surface, SH-4) ─────────────────────────────────────────────

/** Body slip of a bench car right now, rad (signed). */
function bodySlipNow(car: BenchCar): number {
  return bodySlipOf(car.vehicle.body.linvel(), forwardAxisOf(car.vehicle.body.rotation()), car.vehicle.forwardSpeed());
}

/**
 * Drives straight with full throttle until `speed` on the same cover with no sinkage, like a car
 * that rolls onto soft ground at speed; throws when it never gets there.
 */
function accelerateTo(car: BenchCar, speed: number, ground: SurfaceGround, held: Partial<InputMsg>, runner: string): void {
  const firm: SurfaceGround = { ...ground, softness: 0 };
  while (car.vehicle.forwardSpeed() < speed) {
    if (car.time > 120) throw new Error(`${runner}: the car never reached ${speed} m/s`);
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0, ...held }, firm);
  }
}

/** Held driver choices for a surface run: a drive mode and traction control. */
export type HeldInput = Pick<InputMsg, 'driveMode' | 'tractionControl'>;

export interface DriftTurnResult {
  maxBodySlip: number;
  maxRearSlip: number;
  maxFrontSlip: number;
  /** Signed, unwrapped heading change, rad. */
  headingChange: number;
  maxRoll: number;
  flipped: boolean;
}

/**
 * Full left lock at `entrySpeed` on one ground, reached without sinkage. `hold`: 3 s with the throttle holding the speed.
 * `lift`: full throttle for 1 s, then off, 3.5 s in all (a lift-off slide).
 */
export function runDriftTurn(
  config: VehicleConfig, ground: SurfaceGround, entrySpeed: number, mode: 'hold' | 'lift', held: HeldInput = {},
): DriftTurnResult {
  const car = createBenchCar(config);
  accelerateTo(car, entrySpeed, ground, held, 'runDriftTurn');
  const seconds = mode === 'hold' ? 3 : 3.5;
  const startTime = car.time;
  let previousYaw = yawOf(car.vehicle.body.rotation());
  const result: DriftTurnResult = { maxBodySlip: 0, maxRearSlip: 0, maxFrontSlip: 0, headingChange: 0, maxRoll: 0, flipped: false };
  const rear = config.wheel.positions.map((position) => position.z < 0);
  while (car.time - startTime < seconds - 1e-9) {
    const elapsed = car.time - startTime;
    const throttle = mode === 'lift' ? (elapsed < 1 ? 1 : 0) : throttleToHold(car, entrySpeed);
    stepBenchCar(car, { throttle, brake: 0, steer: -1, ...held }, ground);
    const rotation = car.vehicle.body.rotation();
    const yaw = yawOf(rotation);
    let delta = yaw - previousYaw;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    result.headingChange += delta;
    previousYaw = yaw;
    const wheels = car.vehicle.wheelSurface();
    const slipOf = (isRear: boolean): number => {
      const picked = wheels.filter((_wheel, wheelIndex) => rear[wheelIndex] === isRear);
      return picked.reduce((sum, wheel) => sum + wheel.slipAngle, 0) / Math.max(1, picked.length);
    };
    result.maxBodySlip = Math.max(result.maxBodySlip, Math.abs(bodySlipNow(car)));
    result.maxRearSlip = Math.max(result.maxRearSlip, slipOf(true));
    result.maxFrontSlip = Math.max(result.maxFrontSlip, slipOf(false));
    result.maxRoll = Math.max(result.maxRoll, Math.abs(rollOf(rotation)));
    if (isUpsideDown(rotation)) result.flipped = true;
  }
  return result;
}

const CATCH_SLIDE_SECONDS = 1.5;
const CATCH_SECONDS = 4;
const CATCH_DONE_SLIP = (3 * Math.PI) / 180;

/**
 * A slide and its catch: full lock at 60 km/h for 1.5 s, then the driver steers against the slide
 * at half throttle until it is under 3°, then straight, 4 s in all. Returns the slide left then.
 */
export function runCatch(config: VehicleConfig, ground: SurfaceGround): { peakSlip: number; slipAfter: number; flipped: boolean } {
  const car = createBenchCar(config);
  const entry = 60 * KMH;
  accelerateTo(car, entry, ground, {}, 'runCatch');
  let startTime = car.time;
  let peakSlip = 0;
  let flipped = false;
  while (car.time - startTime < CATCH_SLIDE_SECONDS) {
    stepBenchCar(car, { throttle: throttleToHold(car, entry), brake: 0, steer: -1 }, ground);
    peakSlip = Math.max(peakSlip, Math.abs(bodySlipNow(car)));
  }
  startTime = car.time;
  let caught = false;
  while (car.time - startTime < CATCH_SECONDS) {
    const slip = bodySlipNow(car);
    const steer = !caught && Math.abs(slip) > CATCH_DONE_SLIP ? Math.sign(slip) : 0;
    stepBenchCar(car, { throttle: 0.5, brake: 0, steer }, ground);
    if (Math.abs(bodySlipNow(car)) < CATCH_DONE_SLIP) caught = true;
    if (isUpsideDown(car.vehicle.body.rotation())) flipped = true;
  }
  return { peakSlip, slipAfter: Math.abs(bodySlipNow(car)), flipped };
}

// Below this forward speed after a full-throttle run the car counts as stuck.
const STUCK_SPEED = 2 * KMH;

export interface DigResult {
  /** Forward speed at the end, m/s. */
  speed: number;
  /** Deepest sinkage each wheel reached, m. */
  maxSink: readonly number[];
  /** Sinkage at the end, m. */
  sinkAtEnd: readonly number[];
  stuck: boolean;
  /** Share of the weight on the wheels at the end (the rest on the belly). */
  loadShare: number;
  /** Metres driven along the nose. */
  distance: number;
}

/** Full throttle from a standstill for `seconds` on one ground (usually soft sand). */
export function runDig(config: VehicleConfig, ground: SurfaceGround, seconds: number, held: HeldInput = {}): DigResult {
  const car = createBenchCar(config);
  return digOn(car, ground, seconds, held);
}

function digOn(car: BenchCar, ground: SurfaceGround, seconds: number, held: HeldInput): DigResult {
  const start = car.vehicle.body.translation();
  const nose = forwardAxisOf(car.vehicle.body.rotation());
  const maxSink = car.vehicle.wheelSurface().map((wheel) => wheel.sink);
  const startTime = car.time;
  while (car.time - startTime < seconds - 1e-9) {
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0, ...held }, ground);
    car.vehicle.wheelSurface().forEach((wheel, wheelIndex) => { maxSink[wheelIndex] = Math.max(maxSink[wheelIndex], wheel.sink); });
  }
  const end = car.vehicle.body.translation();
  const speed = car.vehicle.forwardSpeed();
  return {
    speed,
    maxSink,
    sinkAtEnd: car.vehicle.wheelSurface().map((wheel) => wheel.sink),
    stuck: speed < STUCK_SPEED,
    loadShare: car.vehicle.wheelLoadShare(),
    distance: (end.x - start.x) * nose.x + (end.z - start.z) * nose.z,
  };
}

export interface EscapeResult {
  /** The dig before the escape (5 s of full throttle, then 2 s more). */
  dig: DigResult;
  /** Metres the car backed out along its own track in 3 s of reverse. */
  backedOut: number;
  /** Sinkage per wheel after the reverse, m. */
  sinkAfter: readonly number[];
}

/** Digs in with 7 s of full throttle, lets go for 0.3 s, then holds reverse for 3 s. */
export function runEscape(config: VehicleConfig, ground: SurfaceGround): EscapeResult {
  const car = createBenchCar(config);
  const dig = digOn(car, ground, 7, {});
  const dugAt = car.vehicle.body.translation();
  const nose = forwardAxisOf(car.vehicle.body.rotation());
  const letGo = car.time;
  while (car.time - letGo < 0.3) stepBenchCar(car, IDLE, ground);
  const reverse = car.time;
  while (car.time - reverse < 3) stepBenchCar(car, { throttle: 0, brake: 1, steer: 0 }, ground);
  const end = car.vehicle.body.translation();
  return {
    dig,
    backedOut: -((end.x - dugAt.x) * nose.x + (end.z - dugAt.z) * nose.z),
    sinkAfter: car.vehicle.wheelSurface().map((wheel) => wheel.sink),
  };
}

/**
 * Reaches `entrySpeed` on the `from` ground, then drives on full throttle over the `to` ground and
 * reports the speed at each of `checkSeconds` and the deepest sinkage.
 */
export function runEnterAtSpeed(
  config: VehicleConfig, from: SurfaceGround, to: SurfaceGround, entrySpeed: number, checkSeconds: readonly number[],
): { speedAt: readonly number[]; maxSink: number } {
  const car = createBenchCar(config);
  accelerateTo(car, entrySpeed, from, {}, 'runEnterAtSpeed');
  const startTime = car.time;
  const speedAt = checkSeconds.map(() => 0);
  let maxSink = 0;
  const lastCheck = Math.max(...checkSeconds);
  while (car.time - startTime < lastCheck - 1e-9) {
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0 }, to);
    const elapsed = car.time - startTime;
    checkSeconds.forEach((check, index) => { if (elapsed <= check + 1e-9) speedAt[index] = car.vehicle.forwardSpeed(); });
    for (const wheel of car.vehicle.wheelSurface()) maxSink = Math.max(maxSink, wheel.sink);
  }
  return { speedAt, maxSink };
}

/** Full throttle in one held drive mode for `seconds` on flat ground: the top speed it reaches. */
export function runTopSpeed(config: VehicleConfig, ground: SurfaceGround, seconds: number, held: HeldInput = {}): number {
  const car = createBenchCar(config);
  let top = 0;
  while (car.time < seconds) {
    stepBenchCar(car, { throttle: 1, brake: 0, steer: 0, ...held }, ground);
    top = Math.max(top, car.vehicle.forwardSpeed());
  }
  return top;
}

/** The deepest a wheel of this car can sink, m. */
export function maxSinkOf(config: Pick<VehicleConfig, 'wheel'>): number {
  return SURFACE_TYRE.maxSinkShare * config.wheel.radius;
}
