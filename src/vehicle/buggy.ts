// src/vehicle/buggy.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildBuggyMesh } from '../render/buggyMesh';
import { createVehiclePhysics, RESET_LIFT, type VehiclePhysics } from '../../shared/vehiclePhysics';
import { restingSuspensionLength, vehicleConfigFor, type VehicleConfig } from './vehicleConfig';
import type { CarId } from './cars';
import type { InputMsg } from '../../shared/protocol';
import type { DrivetrainState } from '../../shared/drivetrain';

// Rapier leaves a wheel with no ground under it at the full rest length, well below its resting
// pose, so a car on its roof looks like its wheels came off. The drawn wheel hangs only this far
// below the resting pose instead, and eases there at DROOP_SPEED (m/s).
const IN_AIR_DROOP = 0.04;
const DROOP_SPEED = 0.8;

export class Buggy {
  readonly mesh: THREE.Group;
  private readonly vehicle: VehiclePhysics;
  private readonly config: VehicleConfig;
  private wheelPivots: THREE.Group[] = [];
  private rollAngle = 0;
  private readonly restingLength: number;
  private readonly shownSuspension: number[];

  constructor(
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    spawn: { x: number; y: number; z: number },
    carId: CarId,
  ) {
    this.config = vehicleConfigFor(carId);
    this.vehicle = createVehiclePhysics(world, spawn, this.config);
    this.restingLength = restingSuspensionLength(this.config.wheel);
    this.shownSuspension = this.config.wheel.positions.map(() => this.restingLength);

    this.mesh = buildBuggyMesh(carId);
    this.wheelPivots = this.mesh.children.slice(1).map((child) => {
      if (!(child instanceof THREE.Group)) throw new Error('Buggy: a wheel pivot of the car mesh is not a Group');
      return child;
    });
    scene.add(this.mesh);
  }

  applyControls(controls: InputMsg, grip: number) {
    this.vehicle.applyInput(controls, grip);
  }

  update() {
    this.vehicle.update(this.world.timestep);

    const t = this.vehicle.body.translation();
    const r = this.vehicle.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);

    // Roll the wheels based on forward speed (local +Z projected from world velocity).
    const lv = this.vehicle.body.linvel();
    const fwdX = 2 * (r.x * r.z + r.w * r.y);
    const fwdY = 2 * (r.y * r.z - r.w * r.x);
    const fwdZ = 1 - 2 * (r.x * r.x + r.y * r.y);
    const fwdSpeed = lv.x * fwdX + lv.y * fwdY + lv.z * fwdZ;
    this.rollAngle += (fwdSpeed * this.world.timestep) / this.config.wheel.radius;

    const steerAngle = this.vehicle.steerAngle();
    for (let i = 0; i < this.wheelPivots.length; i++) {
      const pivot = this.wheelPivots[i];
      const connection = this.vehicle.controller.wheelChassisConnectionPointCs(i);
      const suspension = this.suspensionToShow(i);
      if (connection) pivot.position.set(connection.x, connection.y - suspension, connection.z);
      pivot.rotation.y = this.config.steeredWheels.includes(i) ? steerAngle : 0;
      const spinner = pivot.children[0];
      spinner.rotation.x = this.rollAngle;
    }
  }

  /** On the ground the drawn wheel follows the physics one exactly, so it never floats or sinks. */
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
  }

  /** TEMP debug snapshot. */
  debug() {
    const v = this.vehicle.body.linvel();
    const w = this.vehicle.body.angvel();
    const grounded = [0, 1, 2, 3].map((wheelIndex) => this.vehicle.controller.wheelIsInContact(wheelIndex));
    return { v: { x: v.x, y: v.y, z: v.z }, w: { x: w.x, y: w.y, z: w.z }, grounded };
  }

  /** Horizontal speed in world units per second. */
  speed(): number {
    return this.vehicle.speed();
  }

  /** Engine rpm and gear, for engine sound and the HUD. */
  drivetrain(): Readonly<DrivetrainState> {
    return this.vehicle.drivetrain();
  }

  /** Flip the car back upright a little above its current spot, facing where its nose pointed. */
  reset() {
    this.vehicle.resetUpright(RESET_LIFT);
  }
}
