// shared/vehiclePhysics.ts
// The one driving model for the local car and the server, so remote cars move like the local one.
import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleConfig } from '../src/vehicle/vehicleConfig';
import type { InputMsg } from './protocol';
import {
  WORLD_GRAVITY,
  aeroDragForce,
  createDrivetrainState,
  driveForce,
  drivenLoadShare,
  longitudinalForce,
  pedalIntent,
  stepGearbox,
  withRotatingMass,
  type DrivetrainState,
} from './drivetrain';
import type { GroundGrip } from './terrainGrip';

/** How far (m) R lifts a car before it stands it on its wheels; the client and the server use the same. */
export const RESET_LIFT = 3;

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface VehiclePhysics {
  body: RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
  /** One step of driver input on the ground under the car. */
  applyInput(input: InputMsg, ground: GroundGrip): void;
  update(dt: number): void;
  steerAngle(): number;
  speed(): number;
  /** Speed along the car's nose, m/s; negative when rolling backwards. */
  forwardSpeed(): number;
  /** Engine rpm, gear and ratio after the last applyInput (for engine sound and the HUD). */
  drivetrain(): Readonly<DrivetrainState>;
  wheelsInContact(): number;
  /** Stand the car on its wheels, raised by `lift`, facing the way its nose pointed; stops it. */
  resetUpright(lift: number): void;
}

/** The chassis's own +Z (its nose) in world space. */
export function forwardAxisOf(rotation: Quaternion): { x: number; y: number; z: number } {
  const { x, y, z, w } = rotation;
  return { x: 2 * (x * z + w * y), y: 2 * (y * z - w * x), z: 1 - 2 * (x * x + y * y) };
}

/** The chassis's own +Y (its roof) in world space. */
export function upAxisOf(rotation: Quaternion): { x: number; y: number; z: number } {
  const { x, y, z, w } = rotation;
  return { x: 2 * (x * y - w * z), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + w * x) };
}

/**
 * Upright rotation (yaw only) that keeps the direction the car was heading. A car standing on its
 * nose or tail has no flat heading; its roof then points along the way it was going.
 */
export function uprightRotationFor(rotation: Quaternion): Quaternion {
  const forward = forwardAxisOf(rotation);
  const flatForward = Math.hypot(forward.x, forward.z);
  let yaw: number;
  if (flatForward > 1e-3) {
    yaw = Math.atan2(forward.x, forward.z);
  } else {
    const up = upAxisOf(rotation);
    const noseDown = forward.y < 0;
    yaw = noseDown ? Math.atan2(up.x, up.z) : Math.atan2(-up.x, -up.z);
  }
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** Full-lock steer angle at a speed: reduced so a full turn stays under maxLateralAcceleration. */
export function steerLimitAt(
  config: Pick<VehicleConfig, 'maxSteer' | 'maxLateralAcceleration'>,
  wheelbase: number,
  speed: number,
): number {
  const speedSquared = speed * speed;
  if (speedSquared < 1e-6) return config.maxSteer;
  return Math.min(config.maxSteer, Math.atan((config.maxLateralAcceleration * wheelbase) / speedSquared));
}

export function wheelbaseOf(config: Pick<VehicleConfig, 'wheel'>): number {
  const zs = config.wheel.positions.map((position) => position.z);
  return Math.max(...zs) - Math.min(...zs);
}

export function createVehiclePhysics(
  world: RAPIER.World,
  spawn: { x: number; y: number; z: number },
  config: VehicleConfig,
): VehiclePhysics {
  const drivesEveryWheel = config.drivenWheels.length === config.wheel.positions.length;
  if ((config.driveLayout.kind === 'awd') !== drivesEveryWheel) {
    throw new Error(`createVehiclePhysics: driveLayout "${config.driveLayout.kind}" does not match drivenWheels [${config.drivenWheels.join(', ')}]`);
  }
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
      .setTranslation(0, config.chassis.offsetY, 0)
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
  const wheelCount = config.wheel.positions.length;
  for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
    controller.setWheelSuspensionStiffness(wheelIndex, config.wheel.suspensionStiffness);
    controller.setWheelSuspensionCompression(wheelIndex, config.wheel.suspensionCompression);
    controller.setWheelSuspensionRelaxation(wheelIndex, config.wheel.suspensionRelaxation);
    controller.setWheelMaxSuspensionTravel(wheelIndex, config.wheel.maxSuspensionTravel);
    controller.setWheelMaxSuspensionForce(wheelIndex, config.wheel.maxSuspensionForce);
    controller.setWheelFrictionSlip(wheelIndex, config.wheel.frictionSlip);
  }

  const spec = config.drivetrain;
  const wheelbase = wheelbaseOf(config);
  let currentSteer = 0;
  let drivetrainState = createDrivetrainState(spec);

  const speed = (): number => {
    const velocity = body.linvel();
    return Math.hypot(velocity.x, velocity.z);
  };
  const forwardSpeed = (): number => {
    const velocity = body.linvel();
    const forward = forwardAxisOf(body.rotation());
    return velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;
  };
  const wheelsInContact = (): number => {
    let count = 0;
    for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
      if (controller.wheelIsInContact(wheelIndex)) count++;
    }
    return count;
  };

  return {
    body,
    controller,
    applyInput(input: InputMsg, ground: GroundGrip) {
      const { grip } = ground;
      const dt = world.timestep;
      const alongNose = forwardSpeed();
      const intent = pedalIntent(input.throttle, input.brake, alongNose);
      drivetrainState = stepGearbox(spec, drivetrainState, intent, alongNose, dt);

      const velocity = body.linvel();
      const airSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
      const aeroDrag = aeroDragForce(spec, airSpeed);

      // All tyre forces go through the wheels that touch the ground: a car on its roof gets no push.
      // The engine pushes through the driven wheels only; brakes and rolling resistance act on all.
      const drivenInContact = config.drivenWheels.filter((wheelIndex) => controller.wheelIsInContact(wheelIndex));
      const allInContact: number[] = [];
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
        if (controller.wheelIsInContact(wheelIndex)) allInContact.push(wheelIndex);
      }
      const contacts = allInContact.length;
      const forceWheels = intent.drive > 0 ? drivenInContact : allInContact;
      // On a slope only the part of the weight across the ground presses the tyres down, so
      // traction and rolling resistance shrink with cos θ and a steep face cannot be climbed.
      const up = upAxisOf(body.rotation());
      const nose = forwardAxisOf(body.rotation());
      const uprightShare = Math.max(0, up.y);
      const normalForce = (config.chassis.mass * WORLD_GRAVITY * uprightShare * contacts) / wheelCount;
      // Only the static slope transfer moves load off the driven axle; the transfer under
      // acceleration is left out on purpose, it would make the launch depend on pitch noise.
      const drivenShare = drivenLoadShare(config.driveLayout, wheelbase, nose.y, up.y);
      const drivenNormalForce =
        (config.chassis.mass * WORLD_GRAVITY * uprightShare * drivenShare * drivenInContact.length) / config.drivenWheels.length;
      const aeroAlongNose = airSpeed > 1e-3 ? (-aeroDrag * alongNose) / airSpeed : 0;
      // Without the slope pull here, a steady climb would lose the rotating-mass share of its traction.
      const gravityAlongNose = -config.chassis.mass * WORLD_GRAVITY * nose.y;
      const tyreForce = forceWheels.length === 0 ? 0 : withRotatingMass(spec, longitudinalForce(spec, {
        driveForce: driveForce(spec, drivetrainState, intent, alongNose),
        intent,
        forwardSpeed: alongNose,
        grip,
        rollingResistance: ground.rollingResistance,
        normalForce,
        drivenNormalForce,
        brakeForce: config.brakeForce,
        mass: config.chassis.mass,
        dt,
      }), aeroAlongNose + gravityAlongNose, intent);
      // Negative engine force drives the chassis toward its own front (+Z, away from the chase camera).
      const perWheel = forceWheels.length === 0 ? 0 : -tyreForce / forceWheels.length;
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
        controller.setWheelEngineForce(wheelIndex, forceWheels.includes(wheelIndex) ? perWheel : 0);
      }
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
        // Set every step so the ground under the car can change the grip; grip 1 keeps the base value.
        controller.setWheelFrictionSlip(wheelIndex, config.wheel.frictionSlip * grip);
      }

      if (airSpeed > 1e-3) {
        const dragImpulse = (aeroDrag * dt) / airSpeed;
        body.applyImpulse({ x: -velocity.x * dragImpulse, y: -velocity.y * dragImpulse, z: -velocity.z * dragImpulse }, true);
      }

      // Rapier applies side grip close to the centre of mass, so a car barely leans in a turn. Add
      // the missing roll moment: turn acceleration × mass × the car's own roll arm, around its length.
      if (contacts >= 2) {
        const yawRate = body.angvel().y;
        const turnAcceleration = { x: yawRate * velocity.z, y: 0, z: -yawRate * velocity.x };
        const scale = -config.chassis.mass * config.rollMomentArm * dt;
        body.applyTorqueImpulse({
          x: scale * (up.y * turnAcceleration.z - up.z * turnAcceleration.y),
          y: scale * (up.z * turnAcceleration.x - up.x * turnAcceleration.z),
          z: scale * (up.x * turnAcceleration.y - up.y * turnAcceleration.x),
        }, true);
      }

      // Ramp steering toward the target for an analog feel (not a snap). Negated so a positive
      // steer input turns left: measured steer-angle and yaw share a sign, so left needs +angle.
      const target = -input.steer * steerLimitAt(config, wheelbase, Math.abs(alongNose));
      const maxStep = config.steerSpeed * dt;
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
    forwardSpeed,
    drivetrain(): Readonly<DrivetrainState> {
      return drivetrainState;
    },
    wheelsInContact,
    resetUpright(lift: number) {
      const translation = body.translation();
      body.setTranslation({ x: translation.x, y: translation.y + lift, z: translation.z }, true);
      body.setRotation(uprightRotationFor(body.rotation()), true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      currentSteer = 0;
      drivetrainState = createDrivetrainState(spec);
    },
  };
}
