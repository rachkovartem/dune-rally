// shared/vehiclePhysics.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  createVehiclePhysics,
  forwardAxisOf,
  steerLimitAt,
  upAxisOf,
  uprightRotationFor,
  wheelbaseOf,
  type Quaternion,
  type VehiclePhysics,
} from './vehiclePhysics';
import { WORLD_GRAVITY } from './drivetrain';
import { FULL_GRIP, rollingResistanceFor, type GroundGrip } from './terrainGrip';
import type { InputMsg } from './protocol';
import { CAR_IDS } from '../src/vehicle/cars';
import { restingSuspensionLength, vehicleConfigFor, type VehicleConfig } from '../src/vehicle/vehicleConfig';

const GROUND_TOP = 0;
const IDLE: InputMsg = { throttle: 0, brake: 0, steer: 0 };
const FULL_THROTTLE: InputMsg = { throttle: 1, brake: 0, steer: 0 };

interface TestCar {
  world: RAPIER.World;
  vehicle: VehiclePhysics;
}

/** A car dropped onto a flat, wide ground, heading +Z, the same gravity as the game worlds. */
function carOnFlatGround(config: VehicleConfig): TestCar {
  const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, GROUND_TOP - 0.5, 0), ground);
  return { world, vehicle: createVehiclePhysics(world, { x: 0, y: GROUND_TOP + 2, z: 0 }, config) };
}

// Replacement (S2-3): the car takes the whole ground (grip and rolling resistance), not a grip number.
function drive(car: TestCar, input: InputMsg, seconds: number, ground: GroundGrip = FULL_GRIP): void {
  const steps = Math.round(seconds * 60);
  for (let step = 0; step < steps; step++) {
    car.vehicle.applyInput(input, ground);
    car.world.step();
    car.vehicle.update(car.world.timestep);
  }
}

function settledCar(config: VehicleConfig): TestCar {
  const car = carOnFlatGround(config);
  drive(car, IDLE, 1.5);
  return car;
}

function yawOfBody(car: TestCar): number {
  const forward = forwardAxisOf(car.vehicle.body.rotation());
  return Math.atan2(forward.x, forward.z);
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('createVehiclePhysics(world, spawn, config) — works for every car config (R54, R55, R63)', () => {
  it.each(CAR_IDS)('rests the %s on all four wheels on flat ground', (carId) => {
    const car = carOnFlatGround(vehicleConfigFor(carId));
    drive(car, IDLE, 2);
    expect(car.vehicle.wheelsInContact()).toBe(4);
    expect(car.vehicle.body.isSleeping()).toBe(false);
  });

  it.each(CAR_IDS)('settles the %s at the ride height restingSuspensionLength predicts, and stays there', (carId) => {
    // The body model is placed with restingSuspensionLength (carModel.fitCarToChassis). If Rapier
    // rests the car elsewhere, the drawn wheels float above or sink into the sand.
    const config = vehicleConfigFor(carId);
    const car = carOnFlatGround(config);
    const heights: number[] = [];
    for (let step = 0; step < 180; step++) {
      drive(car, IDLE, 1 / 60);
      heights.push(car.vehicle.body.translation().y);
    }
    const lastHalfSecond = heights.slice(-30);
    const predicted = GROUND_TOP + config.wheel.radius + restingSuspensionLength(config.wheel) - config.wheel.positions[0].y;
    expect(Math.abs(lastHalfSecond[lastHalfSecond.length - 1] - predicted)).toBeLessThan(0.015);
    expect(Math.max(...lastHalfSecond) - Math.min(...lastHalfSecond)).toBeLessThan(0.02);
  });
});

describe('createVehiclePhysics — driving promises (R67, R68, R69)', () => {
  it.each(CAR_IDS)('moves the %s toward its own nose (+Z) under full throttle', (carId) => {
    // The engine force is applied with a negative sign; a sign flip would drive the car backwards.
    const car = settledCar(vehicleConfigFor(carId));
    const start = car.vehicle.body.translation();
    drive(car, FULL_THROTTLE, 3);
    const end = car.vehicle.body.translation();
    expect(end.z - start.z).toBeGreaterThan(1);
    expect(car.vehicle.forwardSpeed()).toBeGreaterThan(0);
  });

  it.each(CAR_IDS)('reaches a lower speed on grip 0.5 than on grip 1 with the same throttle (%s)', (carId) => {
    const firm = settledCar(vehicleConfigFor(carId));
    const soft = settledCar(vehicleConfigFor(carId));
    drive(firm, FULL_THROTTLE, 5, FULL_GRIP);
    drive(soft, FULL_THROTTLE, 5, { grip: 0.5, rollingResistance: rollingResistanceFor(0.5) });
    expect(soft.vehicle.forwardSpeed()).toBeLessThan(firm.vehicle.forwardSpeed());
  });

  it.each(CAR_IDS)('slows the %s down when the brake replaces the throttle', (carId) => {
    const car = settledCar(vehicleConfigFor(carId));
    drive(car, FULL_THROTTLE, 3);
    const beforeBrake = car.vehicle.forwardSpeed();
    drive(car, { throttle: 0, brake: 1, steer: 0 }, 1);
    expect(car.vehicle.forwardSpeed()).toBeLessThan(beforeBrake);
  });

  it.each(CAR_IDS)('holding the brake from a standstill reverses the %s in reverse gear', (carId) => {
    // Automatic-car controls: S at a standstill engages reverse, it does not just hold the car.
    const car = settledCar(vehicleConfigFor(carId));
    const start = car.vehicle.body.translation();
    drive(car, { throttle: 0, brake: 1, steer: 0 }, 3);
    expect(car.vehicle.forwardSpeed()).toBeLessThan(-0.5);
    expect(car.vehicle.body.translation().z).toBeLessThan(start.z);
    expect(car.vehicle.drivetrain().gear).toBe(-1);
  });

  it.each(CAR_IDS)('steer +1 (the D key) turns the %s to the driver\'s right', (carId) => {
    // Facing +Z with Y up, the driver's right is -X. The user reported inverted steering once.
    const car = settledCar(vehicleConfigFor(carId));
    drive(car, { throttle: 1, brake: 0, steer: 1 }, 2);
    expect(car.vehicle.body.translation().x).toBeLessThan(-0.5);
    expect(yawOfBody(car)).toBeLessThan(0);
  });
});

describe('createVehiclePhysics — upside down and resetUpright', () => {
  const ON_THE_ROOF: Quaternion = { x: 0, y: 0, z: 1, w: 0 };

  it('gives a car lying on its roof no wheel contact and no push from the engine', () => {
    const car = carOnFlatGround(vehicleConfigFor('forester'));
    car.vehicle.body.setRotation(ON_THE_ROOF, true);
    drive(car, IDLE, 1.5);
    const start = car.vehicle.body.translation();
    drive(car, FULL_THROTTLE, 2);
    const end = car.vehicle.body.translation();
    expect(car.vehicle.wheelsInContact()).toBe(0);
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeLessThan(0.2);
  });

  it('stands a car on its roof back on its wheels, lifted, still, and facing the way it pointed', () => {
    const car = carOnFlatGround(vehicleConfigFor('pajero'));
    const heading = 1.1;
    // Yaw by `heading`, then roll 180 degrees around the car's own length.
    car.vehicle.body.setRotation({ x: Math.sin(heading / 2), y: 0, z: Math.cos(heading / 2), w: 0 }, true);
    drive(car, FULL_THROTTLE, 1.5);
    const before = car.vehicle.body.translation();
    const headingBefore = yawOfBody(car);
    expect(Math.abs(headingBefore - heading)).toBeLessThan(0.2);

    car.vehicle.resetUpright(3);

    const rotation = car.vehicle.body.rotation();
    expect(upAxisOf(rotation).y).toBeCloseTo(1, 6);
    expect(yawOfBody(car)).toBeCloseTo(headingBefore, 6);
    expect(car.vehicle.body.translation().y - before.y).toBeCloseTo(3, 5);
    expect(car.vehicle.speed()).toBe(0);
    expect(car.vehicle.steerAngle()).toBe(0);
    drive(car, IDLE, 2);
    expect(car.vehicle.wheelsInContact()).toBe(4);
  });

  it('drives toward the nose again after a reset (forward and backward are not swapped)', () => {
    const car = carOnFlatGround(vehicleConfigFor('forester'));
    car.vehicle.body.setRotation(ON_THE_ROOF, true);
    drive(car, IDLE, 1.5);
    car.vehicle.resetUpright(1);
    drive(car, IDLE, 1.5);
    const start = car.vehicle.body.translation();
    const nose = forwardAxisOf(car.vehicle.body.rotation());
    drive(car, FULL_THROTTLE, 2);
    const end = car.vehicle.body.translation();
    expect((end.x - start.x) * nose.x + (end.z - start.z) * nose.z).toBeGreaterThan(1);
  });
});

describe('forwardAxisOf / upAxisOf — agree with three.js rotating the model', () => {
  // The rendered car is rotated by three.js; the physics reads its nose and roof with these
  // helpers. If they disagree, the camera, the steering and R point different ways.
  const rotations: [string, THREE.Quaternion][] = [
    ['identity', new THREE.Quaternion()],
    ['yaw 90 degrees', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)],
    ['on the roof', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI)],
    ['nose down', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)],
    ['any tilt', new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.2, 0.7))],
  ];

  it.each(rotations)('matches +Z and +Y rotated by three.js for %s', (_name, rotation) => {
    const threeForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    const threeUp = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    const forward = forwardAxisOf(rotation);
    const up = upAxisOf(rotation);
    expect(forward.x).toBeCloseTo(threeForward.x, 6);
    expect(forward.y).toBeCloseTo(threeForward.y, 6);
    expect(forward.z).toBeCloseTo(threeForward.z, 6);
    expect(up.x).toBeCloseTo(threeUp.x, 6);
    expect(up.y).toBeCloseTo(threeUp.y, 6);
    expect(up.z).toBeCloseTo(threeUp.z, 6);
  });
});

describe('uprightRotationFor — keeps the heading, drops pitch and roll', () => {
  const quaternionOf = (euler: THREE.Euler): Quaternion => new THREE.Quaternion().setFromEuler(euler);
  const headingOf = (rotation: Quaternion): number => {
    const forward = forwardAxisOf(rotation);
    return Math.atan2(forward.x, forward.z);
  };

  it.each([
    ['upside down, heading 90 degrees', quaternionOf(new THREE.Euler(0, Math.PI / 2, Math.PI, 'YXZ')), Math.PI / 2],
    ['on its side, heading -2 rad', quaternionOf(new THREE.Euler(0, -2, Math.PI / 2, 'YXZ')), -2],
    ['nose down after driving along +Z', quaternionOf(new THREE.Euler(Math.PI / 2, 0, 0)), 0],
    ['tail down after driving along +Z', quaternionOf(new THREE.Euler(-Math.PI / 2, 0, 0)), 0],
  ])('%s → upright with the expected heading', (_name, rotation, expectedHeading) => {
    const upright = uprightRotationFor(rotation);
    expect(upAxisOf(upright).y).toBeCloseTo(1, 6);
    expect(headingOf(upright)).toBeCloseTo(expectedHeading, 6);
    expect(Math.hypot(upright.x, upright.y, upright.z, upright.w)).toBeCloseTo(1, 10);
  });
});

describe('steerLimitAt — full lock never asks for more than maxLateralAcceleration', () => {
  const config = { maxSteer: 0.5, maxLateralAcceleration: 9 };
  const wheelbase = 2.7;
  const lateralAcceleration = (speed: number): number => (speed * speed * Math.tan(steerLimitAt(config, wheelbase, speed))) / wheelbase;

  it.each([0, 1e-4])('gives the full maxSteer at a standstill (speed %s)', (speed) => {
    expect(steerLimitAt(config, wheelbase, speed)).toBe(config.maxSteer);
  });

  it('keeps full lock at walking pace, where the lock alone stays under the limit', () => {
    expect(steerLimitAt(config, wheelbase, 3)).toBe(config.maxSteer);
  });

  it.each([10, 25, 50])('reduces the lock at %s m/s so the turn asks for exactly the limit', (speed) => {
    expect(steerLimitAt(config, wheelbase, speed)).toBeLessThan(config.maxSteer);
    expect(lateralAcceleration(speed)).toBeCloseTo(config.maxLateralAcceleration, 6);
  });

  it('never exceeds the limit at any speed', () => {
    for (let speed = 0.5; speed <= 60; speed += 0.5) {
      expect(lateralAcceleration(speed)).toBeLessThanOrEqual(config.maxLateralAcceleration + 1e-9);
    }
  });
});

describe('wheelbaseOf', () => {
  it('is the distance between the front and the rear axle, whatever the order of the wheels', () => {
    const wheel = (z: number) => ({ x: 0, y: 0, z });
    expect(wheelbaseOf({ wheel: { ...vehicleConfigFor('pajero').wheel, positions: [wheel(-1.5), wheel(1.2), wheel(1.2), wheel(-1.5)] } }))
      .toBeCloseTo(2.7, 10);
  });
});
