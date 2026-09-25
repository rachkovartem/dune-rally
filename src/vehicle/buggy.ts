// src/vehicle/buggy.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildBuggyMesh } from '../render/buggyMesh';
import {
  createVehiclePhysics, RESET_LIFT, type DriveState, type SurfaceState, type VehiclePhysics, type WheelSurface,
} from '../../shared/vehiclePhysics';
import { restingSuspensionLength, vehicleConfigFor, type VehicleConfig } from './vehicleConfig';
import type { CarId } from './cars';
import type { InputMsg } from '../../shared/protocol';
import type { DrivetrainState } from '../../shared/drivetrain';
import type { GroundGrip } from '../../shared/terrainGrip';
import { rotationForYaw, type SpawnPose } from '../world/worldDef';
import { advanceRollAngle } from './wheelRoll';

/** Where a car is put: a spawn or reset pose plus the height of its body. */
export type StandingPose = SpawnPose & { y: number };

// Rapier leaves a wheel with no ground under it at the full rest length, well below its resting
// pose, so a car on its roof looks like its wheels came off. The drawn wheel hangs only this far
// below the resting pose instead, and eases there at DROOP_SPEED (m/s).
const IN_AIR_DROOP = 0.04;
const DROOP_SPEED = 0.8;

/** What the tyres do on the ground as a whole, for the tyre sound. */
export interface TyreSlip {
  /** Fastest wheelspin of a driven wheel on the ground, m/s. */
  wheelSpin: number;
  /** Mean sideways slide of the wheels on the ground, m/s. */
  lateralSlip: number;
}

/** A wheel's contact with how deep it sits and how fast it spins, for the ruts and the roost. */
export interface WheelGroundContact {
  x: number;
  y: number;
  z: number;
  /** Sinkage, m. */
  sink: number;
  /** Wheelspin, m/s. */
  spin: number;
}

export class Buggy {
  readonly mesh: THREE.Group;
  private readonly vehicle: VehiclePhysics;
  private readonly config: VehicleConfig;
  private wheelPivots: THREE.Group[] = [];
  private readonly rollAngles: number[];
  private readonly restingLength: number;
  private readonly shownSuspension: number[];

  constructor(
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    pose: StandingPose,
    carId: CarId,
  ) {
    this.config = vehicleConfigFor(carId);
    this.vehicle = createVehiclePhysics(world, pose, this.config);
    this.vehicle.body.setRotation(rotationForYaw(pose.yaw), true);
    this.restingLength = restingSuspensionLength(this.config.wheel);
    this.shownSuspension = this.config.wheel.positions.map(() => this.restingLength);
    this.rollAngles = this.config.wheel.positions.map(() => 0);

    this.mesh = buildBuggyMesh(carId);
    this.wheelPivots = this.mesh.children.slice(1).map((child) => {
      if (!(child instanceof THREE.Group)) throw new Error('Buggy: a wheel pivot of the car mesh is not a Group');
      return child;
    });
    scene.add(this.mesh);
  }

  applyControls(controls: InputMsg, ground: GroundGrip) {
    this.vehicle.applyInput(controls, ground);
  }

  update() {
    this.vehicle.update(this.world.timestep);

    const translation = this.vehicle.body.translation();
    const rotation = this.vehicle.body.rotation();
    this.mesh.position.set(translation.x, translation.y, translation.z);
    this.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

    // A spinning driven wheel turns at its tread speed, so wheelspin is seen; the others roll with the car.
    const groundSpeed = this.vehicle.forwardSpeed();
    const spinningSpeed = this.vehicle.wheelSurfaceSpeed();
    const wheels = this.vehicle.wheelSurface();
    for (let wheelIndex = 0; wheelIndex < this.rollAngles.length; wheelIndex++) {
      const treadSpeed = wheels[wheelIndex].spinSpeed > 0 ? spinningSpeed : groundSpeed;
      this.rollAngles[wheelIndex] = advanceRollAngle(
        this.rollAngles[wheelIndex], groundSpeed, treadSpeed, this.world.timestep, this.config.wheel.radius,
      );
    }

    const steerAngle = this.vehicle.steerAngle();
    for (let wheelIndex = 0; wheelIndex < this.wheelPivots.length; wheelIndex++) {
      const pivot = this.wheelPivots[wheelIndex];
      const connection = this.vehicle.controller.wheelChassisConnectionPointCs(wheelIndex);
      const suspension = this.suspensionToShow(wheelIndex);
      if (connection) pivot.position.set(connection.x, connection.y - suspension, connection.z);
      pivot.rotation.y = this.config.steeredWheels.includes(wheelIndex) ? steerAngle : 0;
      const spinner = pivot.children[0];
      spinner.rotation.x = this.rollAngles[wheelIndex];
    }
  }

  /**
   * On the ground the drawn wheel follows the physics one exactly, so it never floats. A sunk wheel
   * has a smaller physics radius, so the drawn tyre (full radius) reaches into the sand by the sinkage.
   */
  private suspensionToShow(wheelIndex: number): number {
    const controller = this.vehicle.controller;
    const length = controller.wheelSuspensionLength(wheelIndex);
    if (length === null) throw new Error(`Buggy: the physics car has no wheel ${wheelIndex}`);
    const shown = controller.wheelIsInContact(wheelIndex)
      ? length
      : this.easedDroop(this.shownSuspension[wheelIndex], Math.min(length, this.restingLength + IN_AIR_DROOP));
    this.shownSuspension[wheelIndex] = shown;
    return shown;
  }

  private easedDroop(shown: number, target: number): number {
    const maxStep = DROOP_SPEED * this.world.timestep;
    return shown + Math.max(-maxStep, Math.min(maxStep, target - shown));
  }

  position(): RAPIER.Vector {
    return this.vehicle.body.translation();
  }

  /** TEMP debug teleport. */
  teleport(x: number, y: number, z: number) {
    this.vehicle.body.setTranslation({ x, y, z }, true);
    this.vehicle.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.vehicle.resetSurface();
  }

  /** TEMP debug snapshot. */
  debug() {
    const v = this.vehicle.body.linvel();
    const w = this.vehicle.body.angvel();
    const grounded = [0, 1, 2, 3].map((wheelIndex) => this.vehicle.controller.wheelIsInContact(wheelIndex));
    return { v: { x: v.x, y: v.y, z: v.z }, w: { x: w.x, y: w.y, z: w.z }, grounded };
  }

  /** Where each wheel touches the ground, in wheel order (FL, FR, RL, RR); null for a wheel in the air. */
  wheelContacts(): (WheelGroundContact | null)[] {
    const controller = this.vehicle.controller;
    const wheels = this.vehicle.wheelSurface();
    return this.config.wheel.positions.map((_position, wheelIndex) => {
      if (!controller.wheelIsInContact(wheelIndex)) return null;
      const contact = controller.wheelContactPoint(wheelIndex);
      if (!contact) return null;
      const wheel = wheels[wheelIndex];
      return { x: contact.x, y: contact.y, z: contact.z, sink: wheel.sink, spin: wheel.spinSpeed };
    });
  }

  /** Per wheel (FL, FR, RL, RR): sinkage, slip angle, wheelspin and sideways slide. */
  wheelSurface(): readonly WheelSurface[] {
    return this.vehicle.wheelSurface();
  }

  /** Wheelspin and sinkage, as the pose message carries them. */
  surfaceState(): SurfaceState {
    return this.vehicle.surfaceState();
  }

  /** Wheelspin of the driven wheels, m/s. */
  spin(): number {
    return this.vehicle.spin();
  }

  /** Share of the weight on the wheels; the rest sits on the belly. */
  wheelLoadShare(): number {
    return this.vehicle.wheelLoadShare();
  }

  /** The drive mode (fixed or the one selected) and whether traction control is on, after the last step. */
  driveState(): DriveState {
    return this.vehicle.driveState();
  }

  tyreSlip(): TyreSlip {
    const controller = this.vehicle.controller;
    let wheelSpin = 0;
    let lateralSlip = 0;
    let onGround = 0;
    this.vehicle.wheelSurface().forEach((wheel, wheelIndex) => {
      if (!controller.wheelIsInContact(wheelIndex)) return;
      onGround++;
      wheelSpin = Math.max(wheelSpin, wheel.spinSpeed);
      lateralSlip += wheel.lateralSlip;
    });
    return { wheelSpin, lateralSlip: onGround > 0 ? lateralSlip / onGround : 0 };
  }

  tyreWidth(): number {
    return this.config.wheel.width;
  }

  /** Velocity of the body, m/s. */
  velocity(): { x: number; y: number; z: number } {
    const velocity = this.vehicle.body.linvel();
    return { x: velocity.x, y: velocity.y, z: velocity.z };
  }

  /** Horizontal speed in world units per second. */
  speed(): number {
    return this.vehicle.speed();
  }

  /** Speed along the nose, m/s; negative when rolling backwards. */
  forwardSpeed(): number {
    return this.vehicle.forwardSpeed();
  }

  wheelsInContact(): number {
    return this.vehicle.wheelsInContact();
  }

  wheelCount(): number {
    return this.config.wheel.positions.length;
  }

  /** Engine rpm and gear, for engine sound and the HUD. */
  drivetrain(): Readonly<DrivetrainState> {
    return this.vehicle.drivetrain();
  }

  /** Put the car at a pose, upright, standing still, facing the pose's heading (the border safety net). */
  placeAt(pose: StandingPose) {
    this.vehicle.body.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true);
    this.vehicle.body.setRotation(rotationForYaw(pose.yaw), true);
    this.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.vehicle.resetSurface();
  }

  /** Move the car to a point, upright, at rest, facing where its nose pointed. */
  placeUprightAt(x: number, y: number, z: number) {
    this.vehicle.body.setTranslation({ x, y, z }, true);
    this.vehicle.resetUpright(0);
  }

  /** Flip the car back upright a little above its current spot, facing where its nose pointed. */
  reset() {
    this.vehicle.resetUpright(RESET_LIFT);
  }
}
