// src/vehicle/buggy.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildBuggyMesh } from '../render/buggyMesh';
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
        .setLinearDamping(0.4)
        .setAngularDamping(2.0)
        // Never sleep: a sleeping body ignores the controller's engine force.
        .setCanSleep(false)
        // Low centre of mass + solid angular inertia so the buggy resists flipping/tumbling.
        .setAdditionalMassProperties(
          cfg.chassis.mass,
          { x: 0, y: -0.9, z: 0 },
          { x: 1600, y: 1600, z: 900 },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
    );
    // Density 0: all mass comes from setAdditionalMassProperties above (keeping the low COM).
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(cfg.chassis.hx, cfg.chassis.hy, cfg.chassis.hz).setDensity(0),
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
    this.mesh = buildBuggyMesh();
    this.chassisMesh = this.mesh.children[0] as THREE.Mesh;
    this.wheelMeshes = this.mesh.children.slice(1) as THREE.Mesh[];
    scene.add(this.mesh);
  }

  applyControls(c: { throttle: number; brake: number; steer: number }) {
    // Negative force drives the buggy toward its front (+Z, away from the chase camera).
    const engine = -c.throttle * cfg.engineForce;
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

  /** Horizontal speed in world units per second. */
  speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z);
  }

  /** Flip the buggy back upright a little above its current spot and kill its velocity. */
  reset() {
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x, y: t.y + 3, z: t.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
