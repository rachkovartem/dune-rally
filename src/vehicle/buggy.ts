// src/vehicle/buggy.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildBuggyMesh } from '../render/buggyMesh';
import { vehicleConfig as cfg } from './vehicleConfig';

export class Buggy {
  readonly mesh: THREE.Group;
  private body: RAPIER.RigidBody;
  private controller: RAPIER.DynamicRayCastVehicleController;
  private wheelPivots: THREE.Group[] = [];
  private currentSteer = 0;
  private rollAngle = 0;

  constructor(
    private world: RAPIER.World,
    scene: THREE.Scene,
    spawn: { x: number; y: number; z: number },
  ) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setLinearDamping(cfg.linearDamping)
        .setAngularDamping(cfg.angularDamping)
        .setCanSleep(false) // a sleeping body ignores the controller's engine force
        .setAdditionalMassProperties(
          cfg.chassis.mass,
          cfg.com,
          cfg.inertia,
          { x: 0, y: 0, z: 0, w: 1 },
        ),
    );
    // Density 0: mass comes from setAdditionalMassProperties (keeping the low COM). Restitution +
    // friction give terrain/obstacle hits some bounce and scrub instead of a dead stop.
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(cfg.chassis.hx, cfg.chassis.hy, cfg.chassis.hz)
        .setDensity(0)
        .setRestitution(cfg.restitution)
        .setFriction(cfg.friction),
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
      this.controller.setWheelSuspensionCompression(i, cfg.wheel.suspensionCompression);
      this.controller.setWheelSuspensionRelaxation(i, cfg.wheel.suspensionRelaxation);
      this.controller.setWheelMaxSuspensionTravel(i, cfg.wheel.maxSuspensionTravel);
      this.controller.setWheelFrictionSlip(i, cfg.wheel.frictionSlip);
    }

    this.mesh = buildBuggyMesh();
    this.wheelPivots = this.mesh.children.slice(1) as THREE.Group[];
    scene.add(this.mesh);
  }

  applyControls(c: { throttle: number; brake: number; steer: number }) {
    // Negative engine force drives the buggy toward its front (+Z, away from the chase camera).
    // Force tapers to 0 as speed approaches maxSpeed → a modest, heavy top speed.
    const speedFactor = Math.max(0, 1 - this.speed() / cfg.maxSpeed);
    const engine = -c.throttle * cfg.engineForce * speedFactor;
    const brake = c.brake * cfg.brakeForce;
    for (const i of cfg.drivenWheels) this.controller.setWheelEngineForce(i, engine);
    for (let i = 0; i < cfg.wheel.positions.length; i++) this.controller.setWheelBrake(i, brake);

    // Ramp steering toward the target for an analog feel (not a snap). Negated so A/left turns
    // the buggy left: measured steer-angle and yaw share a sign, so left input needs +angle.
    const target = -c.steer * cfg.maxSteer;
    const maxStep = cfg.steerSpeed * this.world.timestep;
    this.currentSteer += Math.max(-maxStep, Math.min(maxStep, target - this.currentSteer));
    for (const i of cfg.steeredWheels) this.controller.setWheelSteering(i, this.currentSteer);
  }

  update() {
    this.controller.updateVehicle(this.world.timestep);

    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);

    // Roll the wheels based on forward speed (local +Z projected from world velocity).
    const lv = this.body.linvel();
    const fwdX = 2 * (r.x * r.z + r.w * r.y);
    const fwdY = 2 * (r.y * r.z - r.w * r.x);
    const fwdZ = 1 - 2 * (r.x * r.x + r.y * r.y);
    const fwdSpeed = lv.x * fwdX + lv.y * fwdY + lv.z * fwdZ;
    this.rollAngle += (fwdSpeed * this.world.timestep) / cfg.wheel.radius;

    for (let i = 0; i < this.wheelPivots.length; i++) {
      const pivot = this.wheelPivots[i];
      const conn = this.controller.wheelChassisConnectionPointCs(i);
      const susp = this.controller.wheelSuspensionLength(i) ?? cfg.wheel.suspensionRestLength;
      if (conn) pivot.position.set(conn.x, conn.y - susp, conn.z);
      pivot.rotation.y = cfg.steeredWheels.includes(i) ? this.currentSteer : 0;
      const spinner = pivot.children[0] as THREE.Object3D;
      spinner.rotation.x = this.rollAngle;
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
