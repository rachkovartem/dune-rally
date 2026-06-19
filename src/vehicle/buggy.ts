// src/vehicle/buggy.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { makeToonMaterial } from '../render/celShading';
import { vehicleConfig as cfg } from './vehicleConfig';

export class Buggy {
  readonly mesh: THREE.Group;
  private body: RAPIER.RigidBody;
  private controller: RAPIER.DynamicRayCastVehicleController;
  private chassisMesh: THREE.Mesh;
  private wheelMeshes: THREE.Mesh[] = [];

  constructor(
    private world: RAPIER.World,
    scene: THREE.Scene,
    spawn: { x: number; y: number; z: number },
  ) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setLinearDamping(0.1)
        .setAngularDamping(0.5)
        // A player vehicle must never sleep: a sleeping body ignores the controller's engine
        // force, so the buggy would settle and then refuse to respond to throttle.
        .setCanSleep(false),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(cfg.chassis.hx, cfg.chassis.hy, cfg.chassis.hz)
        .setMass(cfg.chassis.mass),
      this.body,
    );

    this.controller = world.createVehicleController(this.body);
    const down = new RAPIER.Vector3(0, -1, 0);
    const axle = new RAPIER.Vector3(1, 0, 0);
    for (const p of cfg.wheel.positions) {
      this.controller.addWheel(
        new RAPIER.Vector3(p.x, p.y, p.z),
        down,
        axle,
        cfg.wheel.suspensionRestLength,
        cfg.wheel.radius,
      );
    }
    for (let i = 0; i < cfg.wheel.positions.length; i++) {
      this.controller.setWheelSuspensionStiffness(i, cfg.wheel.suspensionStiffness);
      this.controller.setWheelMaxSuspensionTravel(i, cfg.wheel.maxSuspensionTravel);
    }

    // Visuals
    this.mesh = new THREE.Group();
    this.chassisMesh = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.chassis.hx * 2, cfg.chassis.hy * 2, cfg.chassis.hz * 2),
      makeToonMaterial(0xff8a3d),
    );
    this.mesh.add(this.chassisMesh);
    for (const _ of cfg.wheel.positions) {
      const w = new THREE.Mesh(
        new THREE.CylinderGeometry(cfg.wheel.radius, cfg.wheel.radius, 0.4, 16),
        makeToonMaterial(0x222222),
      );
      w.rotation.z = Math.PI / 2;
      this.wheelMeshes.push(w);
      this.mesh.add(w);
    }
    scene.add(this.mesh);
  }

  applyControls(c: { throttle: number; brake: number; steer: number }) {
    const engine = c.throttle * cfg.engineForce;
    const brake = c.brake * cfg.brakeForce;
    const steer = c.steer * cfg.maxSteer;
    for (const i of cfg.drivenWheels) this.controller.setWheelEngineForce(i, engine);
    for (let i = 0; i < cfg.wheel.positions.length; i++) this.controller.setWheelBrake(i, brake);
    for (const i of cfg.steeredWheels) this.controller.setWheelSteering(i, steer);
  }

  update() {
    this.controller.updateVehicle(this.world.timestep);

    const t = this.body.translation();
    const r = this.body.rotation();
    this.chassisMesh.position.set(0, 0, 0);
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);

    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const conn = this.controller.wheelChassisConnectionPointCs(i);
      const susp = this.controller.wheelSuspensionLength(i) ?? cfg.wheel.suspensionRestLength;
      if (conn) this.wheelMeshes[i].position.set(conn.x, conn.y - susp, conn.z);
    }
  }

  position(): RAPIER.Vector {
    return this.body.translation();
  }
}
