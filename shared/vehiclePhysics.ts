// shared/vehiclePhysics.ts
// The one driving model for the local car and the server, so remote cars move like the local one.
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleConfig } from '../src/vehicle/vehicleConfig';
import type { InputMsg } from './protocol';

export interface VehiclePhysics {
  body: RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
  applyInput(input: InputMsg, grip: number): void;
  update(dt: number): void;
  steerAngle(): number;
  speed(): number;
}

export function createVehiclePhysics(
  world: RAPIER.World,
  spawn: { x: number; y: number; z: number },
  config: VehicleConfig,
): VehiclePhysics {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(config.linearDamping)
      .setAngularDamping(config.angularDamping)
      .setCanSleep(false) // a sleeping body ignores the controller's engine force
      .setAdditionalMassProperties(
        config.chassis.mass,
        config.com,
        config.inertia,
        { x: 0, y: 0, z: 0, w: 1 },
      ),
  );
  // Density 0: mass comes from setAdditionalMassProperties (keeping the low COM). Restitution +
  // friction give terrain/obstacle hits some bounce and scrub instead of a dead stop.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(config.chassis.hx, config.chassis.hy, config.chassis.hz)
      .setDensity(0)
      .setRestitution(config.restitution)
      .setFriction(config.friction),
    body,
  );

  const controller = world.createVehicleController(body);
  const down = new RAPIER.Vector3(0, -1, 0);
  const axle = new RAPIER.Vector3(1, 0, 0);
  for (const wheelPosition of config.wheel.positions) {
    controller.addWheel(
      new RAPIER.Vector3(wheelPosition.x, wheelPosition.y, wheelPosition.z),
      down,
      axle,
      config.wheel.suspensionRestLength,
      config.wheel.radius,
    );
  }
  for (let wheelIndex = 0; wheelIndex < config.wheel.positions.length; wheelIndex++) {
    controller.setWheelSuspensionStiffness(wheelIndex, config.wheel.suspensionStiffness);
    controller.setWheelSuspensionCompression(wheelIndex, config.wheel.suspensionCompression);
    controller.setWheelSuspensionRelaxation(wheelIndex, config.wheel.suspensionRelaxation);
    controller.setWheelMaxSuspensionTravel(wheelIndex, config.wheel.maxSuspensionTravel);
    controller.setWheelFrictionSlip(wheelIndex, config.wheel.frictionSlip);
  }

  let currentSteer = 0;

  const speed = (): number => {
    const velocity = body.linvel();
    return Math.hypot(velocity.x, velocity.z);
  };

  return {
    body,
    controller,
    applyInput(input: InputMsg, grip: number) {
      // Negative engine force drives the chassis toward its own front (+Z, away from the chase
      // camera). Force tapers to 0 as speed approaches maxSpeed → a bounded, heavy top speed.
      const speedFactor = Math.max(0, 1 - speed() / config.maxSpeed);
      const engine = -input.throttle * config.engineForce * speedFactor;
      const brake = input.brake * config.brakeForce;
      for (const wheelIndex of config.drivenWheels) controller.setWheelEngineForce(wheelIndex, engine);
      for (let wheelIndex = 0; wheelIndex < config.wheel.positions.length; wheelIndex++) {
        controller.setWheelBrake(wheelIndex, brake);
        // Set every step so the ground under the car can change the grip; grip 1 keeps the base value.
        controller.setWheelFrictionSlip(wheelIndex, config.wheel.frictionSlip * grip);
      }

      // Ramp steering toward the target for an analog feel (not a snap). Negated so a positive
      // steer input turns left: measured steer-angle and yaw share a sign, so left needs +angle.
      const target = -input.steer * config.maxSteer;
      const maxStep = config.steerSpeed * world.timestep;
      currentSteer += Math.max(-maxStep, Math.min(maxStep, target - currentSteer));
      for (const wheelIndex of config.steeredWheels) controller.setWheelSteering(wheelIndex, currentSteer);
    },
    update(dt: number) {
      controller.updateVehicle(dt);
    },
    steerAngle(): number {
      return currentSteer;
    },
    speed,
  };
}
