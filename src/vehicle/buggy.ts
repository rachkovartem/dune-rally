// src/vehicle/buggy.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildBuggyMesh } from '../render/buggyMesh';
import { createVehiclePhysics, type VehiclePhysics } from '../../shared/vehiclePhysics';
import { vehicleConfigFor, type VehicleConfig } from './vehicleConfig';
import type { CarId } from './cars';
import type { InputMsg } from '../../shared/protocol';

export class Buggy {
  readonly mesh: THREE.Group;
  private readonly vehicle: VehiclePhysics;
  private readonly config: VehicleConfig;
  private wheelPivots: THREE.Group[] = [];
  private rollAngle = 0;

  constructor(
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    spawn: { x: number; y: number; z: number },
    carId: CarId,
  ) {
    this.config = vehicleConfigFor(carId);
    this.vehicle = createVehiclePhysics(world, spawn, this.config);

    this.mesh = buildBuggyMesh(carId);
    this.wheelPivots = this.mesh.children.slice(1).map((child) => {
      if (!(child instanceof THREE.Group)) throw new Error('Buggy: a wheel pivot of the car mesh is not a Group');
      return child;
    });
    scene.add(this.mesh);
  }

  applyControls(controls: InputMsg, grip = 1) {
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
      const conn = this.vehicle.controller.wheelChassisConnectionPointCs(i);
      const susp = this.vehicle.controller.wheelSuspensionLength(i) ?? this.config.wheel.suspensionRestLength;
      if (conn) pivot.position.set(conn.x, conn.y - susp, conn.z);
      pivot.rotation.y = this.config.steeredWheels.includes(i) ? steerAngle : 0;
      const spinner = pivot.children[0];
      spinner.rotation.x = this.rollAngle;
    }
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

  /** Flip the buggy back upright a little above its current spot and kill its velocity. */
  reset() {
    const t = this.vehicle.body.translation();
    this.vehicle.body.setTranslation({ x: t.x, y: t.y + 3, z: t.z }, true);
    this.vehicle.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
