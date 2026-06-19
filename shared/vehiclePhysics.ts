// shared/vehiclePhysics.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { vehicleConfig as cfg } from '../src/vehicle/vehicleConfig';
import type { InputMsg } from './protocol';

export interface VehiclePhysics {
  body: RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
  applyInput(i: InputMsg): void;
  update(dt: number): void;
}

export function createVehiclePhysics(
  world: RAPIER.World,
  spawn: { x: number; y: number; z: number },
): VehiclePhysics {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(0.1)
      .setAngularDamping(0.5)
      .setCanSleep(false),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(cfg.chassis.hx, cfg.chassis.hy, cfg.chassis.hz).setMass(cfg.chassis.mass),
    body,
  );

  const controller = world.createVehicleController(body);
  const down = new RAPIER.Vector3(0, -1, 0);
  const axle = new RAPIER.Vector3(1, 0, 0);
  for (const p of cfg.wheel.positions) {
    controller.addWheel(new RAPIER.Vector3(p.x, p.y, p.z), down, axle, cfg.wheel.suspensionRestLength, cfg.wheel.radius);
  }
  for (let i = 0; i < cfg.wheel.positions.length; i++) {
    controller.setWheelSuspensionStiffness(i, cfg.wheel.suspensionStiffness);
    controller.setWheelMaxSuspensionTravel(i, cfg.wheel.maxSuspensionTravel);
  }

  return {
    body,
    controller,
    applyInput(i: InputMsg) {
      const engine = i.throttle * cfg.engineForce;
      const brake = i.brake * cfg.brakeForce;
      const steer = i.steer * cfg.maxSteer;
      for (const w of cfg.drivenWheels) controller.setWheelEngineForce(w, engine);
      for (let w = 0; w < cfg.wheel.positions.length; w++) controller.setWheelBrake(w, brake);
      for (const w of cfg.steeredWheels) controller.setWheelSteering(w, steer);
    },
    update(dt: number) {
      controller.updateVehicle(dt);
    },
  };
}
