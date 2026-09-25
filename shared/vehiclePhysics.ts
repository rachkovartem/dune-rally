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
  type DrivetrainSpec,
  type DrivetrainState,
} from './drivetrain';
import type { SurfaceGround } from './terrainGrip';
import {
  bodySlipOf, countersteer, onOwnTrack, rollingDirection, sideGrip, sinkEffects, sinkStep, slipAngle, spinAllowance, spinStep,
  staticSinkage, SURFACE_TYRE,
} from './surfaceTyre';
import {
  axleLoadShares, centreDiffTraction, isCentreLocked, isLowRange, lockedScrubShare, LOCKED_CENTRE_SCRUB, nextDriveMode,
  type DriveMode, type DriveModeBlock,
} from './driveModes';

/** How far (m) R lifts a car before it stands it on its wheels; the client and the server use the same. */
export const RESET_LIFT = 3;

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** What one wheel does on the ground, for sound, ruts and the debug readout. */
export interface WheelSurface {
  /** How deep the wheel sits in the ground, m. */
  sink: number;
  /** Slip angle, rad (≥ 0). */
  slipAngle: number;
  /** Wheelspin of this wheel, m/s (0 for a wheel that is not driven). */
  spinSpeed: number;
  /** Speed of the contact point across the wheel, m/s (≥ 0). */
  lateralSlip: number;
}

/** Wheelspin and sinkage: the state a pose snap copies from the driver's car to the server copy. */
export interface SurfaceState {
  spin: number;
  spinDirection: 1 | -1;
  sink: readonly number[];
  digDirection: readonly (1 | -1)[];
}

/** Drive mode for the HUD: a car either has one fixed layout or lets the driver pick the mode. */
export type DriveModeState =
  | { kind: 'fixed'; layout: 'awd' | 'fwd' }
  | { kind: 'selectable'; mode: DriveMode; requested: DriveMode; blocked: DriveModeBlock };

export interface DriveState {
  drive: DriveModeState;
  tractionControl: boolean;
}

export interface VehiclePhysics {
  body: RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
  /** One step of driver input on the ground under the car. */
  applyInput(input: InputMsg, ground: SurfaceGround): void;
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
  /** Per wheel, in wheel order (FL, FR, RL, RR). */
  wheelSurface(): readonly WheelSurface[];
  /** Speed of the driven tyres' surface along the nose, m/s: the ground speed plus the spin. */
  wheelSurfaceSpeed(): number;
  /** Wheelspin of the driven wheels, m/s (≥ 0). */
  spin(): number;
  /** Share of the weight the wheels carry; the rest sits on the belly (1 when not sunk in). */
  wheelLoadShare(): number;
  surfaceState(): SurfaceState;
  /** Copies the driver's wheelspin and sinkage; throws when the wheel count does not match. */
  setSurfaceState(state: SurfaceState): void;
  /** No spin, no sinkage: for every place that puts the car somewhere new. */
  resetSurface(): void;
  driveState(): DriveState;
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

/** The chassis's own +X in world space; a wheel steered by angle a heads along sin(a) * this + cos(a) * nose. */
function rightAxisOf(rotation: Quaternion): { x: number; y: number; z: number } {
  const { x, y, z, w } = rotation;
  return { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + w * z), z: 2 * (x * z - w * y) };
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

/**
 * Force share of each wheel that pushes. With a rear share the two axles split the force and each
 * axle splits its part equally; when one axle has no wheel down, the other takes it all.
 */
function wheelForceShares(forceWheels: readonly number[], isRear: readonly boolean[], rearShare: number | null): Map<number, number> {
  const shares = new Map<number, number>();
  const rearWheels = forceWheels.filter((wheelIndex) => isRear[wheelIndex]);
  const frontWheels = forceWheels.filter((wheelIndex) => !isRear[wheelIndex]);
  if (rearShare === null || rearWheels.length === 0 || frontWheels.length === 0) {
    for (const wheelIndex of forceWheels) shares.set(wheelIndex, 1 / forceWheels.length);
    return shares;
  }
  for (const wheelIndex of frontWheels) shares.set(wheelIndex, (1 - rearShare) / frontWheels.length);
  for (const wheelIndex of rearWheels) shares.set(wheelIndex, rearShare / rearWheels.length);
  return shares;
}

export function createVehiclePhysics(
  world: RAPIER.World,
  spawn: { x: number; y: number; z: number },
  config: VehicleConfig,
): VehiclePhysics {
  const wheelCount = config.wheel.positions.length;
  const drivesEveryWheel = config.drivenWheels.length === wheelCount;
  const allWheelDrive = config.driveLayout.kind === 'awd';
  if (allWheelDrive !== drivesEveryWheel) {
    throw new Error(`createVehiclePhysics: driveLayout "${config.driveLayout.kind}" does not match drivenWheels [${config.drivenWheels.join(', ')}]`);
  }
  const rearDriveShare = config.surface.rearDriveShare;
  if (allWheelDrive !== (rearDriveShare !== undefined)) {
    throw new Error(`createVehiclePhysics: surface.rearDriveShare must be set for AWD and only for AWD (driveLayout "${config.driveLayout.kind}")`);
  }
  if (rearDriveShare !== undefined && !(rearDriveShare > 0 && rearDriveShare < 1)) {
    throw new Error(`createVehiclePhysics: surface.rearDriveShare ${rearDriveShare} is outside (0, 1)`);
  }
  const selectable = config.driveSelect;
  if (selectable && !allWheelDrive) throw new Error('createVehiclePhysics: a selectable drive needs an AWD car');
  // 4H splits the drive at the car's own rear share; the checks above make it present here.
  const openCentreRearShare = selectable && rearDriveShare !== undefined ? rearDriveShare : null;

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(config.linearDamping)
      .setAngularDamping(config.angularDamping)
      .setCanSleep(false) // a sleeping body would ignore the tyre impulses and the suspension
      .setAdditionalMassProperties(
        config.chassis.mass,
        config.com,
        config.inertia,
        { x: 0, y: 0, z: 0, w: 1 },
      ),
  );
  // Density 0: mass comes from setAdditionalMassProperties (keeping the low COM). Restitution +
  // friction give terrain/obstacle hits some bounce and scrub instead of a dead stop. The belly box
  // is the first collider: the bench measures the underbody on it.
  const bellyCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(config.chassis.hx, config.chassis.hy, config.chassis.hz)
      .setTranslation(0, config.chassis.offsetY, 0)
      .setDensity(0)
      .setRestitution(config.restitution)
      .setFriction(config.friction),
    body,
  );
  const overhang = config.chassis.overhang;
  if (overhang) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(config.chassis.hx, overhang.hy, overhang.hz)
        .setTranslation(0, overhang.offsetY, 0)
        .setDensity(0)
        .setRestitution(config.restitution)
        .setFriction(config.friction),
      body,
    );
  }

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
  for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
    controller.setWheelSuspensionStiffness(wheelIndex, config.wheel.suspensionStiffness);
    controller.setWheelSuspensionCompression(wheelIndex, config.wheel.suspensionCompression);
    controller.setWheelSuspensionRelaxation(wheelIndex, config.wheel.suspensionRelaxation);
    controller.setWheelMaxSuspensionTravel(wheelIndex, config.wheel.maxSuspensionTravel);
    controller.setWheelMaxSuspensionForce(wheelIndex, config.wheel.maxSuspensionForce);
    controller.setWheelFrictionSlip(wheelIndex, config.wheel.frictionSlip);
  }

  const spec = config.drivetrain;
  // Low range multiplies every ratio, so it acts like a taller final drive.
  const lowRangeSpec: DrivetrainSpec | null = selectable
    ? { ...spec, finalDrive: spec.finalDrive * selectable.lowRangeRatio }
    : null;
  const wheelbase = wheelbaseOf(config);
  const radius = config.wheel.radius;
  const maxSink = SURFACE_TYRE.maxSinkShare * radius;
  const isRear = config.wheel.positions.map((position) => position.z < 0);
  const rearWheels = config.drivenWheels.filter((wheelIndex) => isRear[wheelIndex]);
  const frontCount = isRear.filter((rear) => !rear).length;
  const rearCount = wheelCount - frontCount;
  const spinInertia = Math.max(SURFACE_TYRE.minSpinInertiaShare, spec.rotatingMassFactor - 1) * config.chassis.mass;

  let currentSteer = 0;
  let drivetrainState = createDrivetrainState(spec);
  let spin = 0;
  let spinDirection: 1 | -1 = 1;
  const sink = config.wheel.positions.map(() => 0);
  const digDirection: (1 | -1)[] = config.wheel.positions.map((): 1 | -1 => 1);
  const telemetry: WheelSurface[] = config.wheel.positions.map(() => ({ sink: 0, slipAngle: 0, spinSpeed: 0, lateralSlip: 0 }));
  let loadShare = 1;
  // Where the centre of mass was at the last applyInput; null after the car was put somewhere new.
  let lastCentre: { x: number; y: number; z: number } | null = null;
  // The last step's acceleration force as a share of the weight on the ground: it moves load to the rear axle.
  let accelerationShare = 0;
  let tractionControl = true;
  let driveMode: DriveMode | null = selectable ? selectable.startMode : null;
  let requestedMode: DriveMode | null = driveMode;
  let driveModeBlock: DriveModeBlock = null;

  const drivenWheelsNow = (): readonly number[] => (driveMode === '2H' ? rearWheels : config.drivenWheels);

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
  const resetSurface = (): void => {
    lastCentre = null;
    spin = 0;
    spinDirection = 1;
    loadShare = 1;
    accelerationShare = 0;
    for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
      sink[wheelIndex] = 0;
      digDirection[wheelIndex] = 1;
      telemetry[wheelIndex] = { sink: 0, slipAngle: 0, spinSpeed: 0, lateralSlip: 0 };
      controller.setWheelRadius(wheelIndex, radius);
    }
    bellyCollider.setFriction(config.friction);
  };

  return {
    body,
    controller,
    applyInput(input: InputMsg, ground: SurfaceGround) {
      const dt = world.timestep;
      const alongNose = forwardSpeed();
      const intent = pedalIntent(input.throttle, input.brake, alongNose);
      tractionControl = input.tractionControl !== false;
      if (selectable && driveMode !== null) {
        if (input.driveMode !== undefined) requestedMode = input.driveMode;
        const next = nextDriveMode(driveMode, requestedMode ?? driveMode, alongNose, selectable);
        driveMode = next.mode;
        driveModeBlock = next.blocked;
      }
      const lowRange = driveMode !== null && isLowRange(driveMode);
      const centreLocked = driveMode !== null && isCentreLocked(driveMode);
      const driveSpec = lowRange && lowRangeSpec ? lowRangeSpec : spec;
      const drivenWheels = drivenWheelsNow();

      // The engine turns with the driven tyres, so their spin flares the revs.
      drivetrainState = stepGearbox(driveSpec, drivetrainState, intent, alongNose + spinDirection * spin, dt);

      const velocity = body.linvel();
      const airSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
      const aeroDrag = aeroDragForce(spec, airSpeed);

      // All tyre forces go through the wheels that touch the ground: a car on its roof gets no push.
      // The engine pushes through the driven wheels only; brakes and rolling resistance act on all.
      const inContact: boolean[] = [];
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) inContact.push(controller.wheelIsInContact(wheelIndex));
      const drivenInContact = drivenWheels.filter((wheelIndex) => inContact[wheelIndex]);
      const allInContact: number[] = [];
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
        if (inContact[wheelIndex]) allInContact.push(wheelIndex);
      }
      const contacts = allInContact.length;
      const forceWheels = intent.drive > 0 ? drivenInContact : allInContact;
      const rotation = body.rotation();
      const up = upAxisOf(rotation);
      const nose = forwardAxisOf(rotation);
      const right = rightAxisOf(rotation);
      // On a slope only the part of the weight across the ground presses the tyres down, so
      // traction and rolling resistance shrink with cos θ and a steep face cannot be climbed.
      const uprightShare = Math.max(0, up.y);
      const weight = config.chassis.mass * WORLD_GRAVITY * uprightShare;

      // A sunk car rests partly on its belly: only the weight the springs carry presses the tyres.
      const anySunk = sink.some((depth) => depth > SURFACE_TYRE.rutDepth);
      if (anySunk && contacts === wheelCount && weight > 1) {
        let carried = 0;
        for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) carried += controller.wheelSuspensionForce(wheelIndex) ?? 0;
        const measured = Math.min(1, carried / weight);
        loadShare += (measured - loadShare) * Math.min(1, dt / SURFACE_TYRE.loadShareSeconds);
      } else {
        loadShare = 1;
      }
      const wheelWeight = weight * loadShare;
      const normalForce = (wheelWeight * contacts) / wheelCount;

      const settled = staticSinkage(ground.softness, config.surface.flotation, alongNose);
      const moving = rollingDirection(alongNose, intent.drive, intent.direction);
      const ownTrack = sink.map((depth, wheelIndex) => onOwnTrack(moving, digDirection[wheelIndex], depth, settled));
      const sinkage = sinkEffects({
        sinks: sink, ownTrack, drivenWheels, staticSink: settled, radius, baseRollingResistance: ground.rollingResistance,
      });
      const grip = ground.grip * sinkage.gripFactor;
      const scrub = centreLocked ? lockedScrubShare(currentSteer, config.maxSteer, ground.looseness) : 0;
      const rollingResistance = sinkage.rollingResistance + scrub * LOCKED_CENTRE_SCRUB.rollingResistance;

      // Most drive force the driven tyres pass to the ground before they spin.
      const peakFriction = spec.tyrePeakFriction * grip;
      let peakTraction: number;
      let rearShare: number | null = allWheelDrive && rearDriveShare !== undefined ? rearDriveShare : null;
      if (selectable && driveMode !== null) {
        const loads = axleLoadShares(selectable, wheelbase, nose.y, up.y, accelerationShare);
        const frontDown = allInContact.filter((wheelIndex) => !isRear[wheelIndex]).length;
        const rearDown = contacts - frontDown;
        const frontLimit = peakFriction * wheelWeight * loads.front * (frontDown / frontCount);
        const rearLimit = peakFriction * wheelWeight * loads.rear * (rearDown / rearCount);
        if (driveMode === '2H') {
          peakTraction = rearLimit;
          rearShare = null;
        } else if (centreLocked) {
          peakTraction = frontLimit + rearLimit;
          // Both axles turn at one speed, so the force goes where the grip is.
          rearShare = peakTraction > 0 ? rearLimit / peakTraction : 0.5;
        } else {
          if (openCentreRearShare === null) throw new Error('createVehiclePhysics: a selectable drive has no rear share');
          peakTraction = centreDiffTraction(frontLimit, rearLimit, openCentreRearShare, selectable.centreDiffBias);
          rearShare = openCentreRearShare;
        }
      } else {
        // Only the static slope transfer moves load off the driven axle; the transfer under
        // acceleration is left out on purpose, it would make the launch depend on pitch noise.
        const drivenShare = drivenLoadShare(config.driveLayout, wheelbase, nose.y, up.y);
        peakTraction = (peakFriction * wheelWeight * drivenShare * drivenInContact.length) / drivenWheels.length;
      }
      const drivenNormalForce = peakFriction > 0 ? peakTraction / peakFriction : 0;

      const demanded = driveForce(driveSpec, drivetrainState, intent, alongNose + spinDirection * spin);
      // Traction control watches the engine revs, so in low range the same rev flare is less wheel slip.
      const allowance = tractionControl
        ? spinAllowance(config.surface, ground.looseness, alongNose) / (lowRange && selectable ? selectable.lowRangeRatio : 1)
        : null;
      const spinning = spinStep({
        spin, spinDirection, drive: intent.drive, direction: intent.direction, demandedForce: demanded, peakTraction,
        looseness: ground.looseness, allowance, spinInertia, drivenInContact: drivenInContact.length > 0, dt,
      });
      spin = spinning.spin;
      spinDirection = spinning.spinDirection;

      const aeroAlongNose = airSpeed > 1e-3 ? (-aeroDrag * alongNose) / airSpeed : 0;
      // Without the slope pull here, a steady climb would lose the rotating-mass share of its traction.
      const gravityAlongNose = -config.chassis.mass * WORLD_GRAVITY * nose.y;
      const externalAlongNose = aeroAlongNose + gravityAlongNose;
      // Rapier adds the suspension impulses after its step, so on a slope the body moves a little
      // differently from the velocity it reports, and a car held by its tyres crept a few mm/s. The
      // tyre force uses what the centre of mass really moved along the nose in the last step.
      const centre = body.worldCom();
      const movedAlongNose = lastCentre === null ? alongNose
        : ((centre.x - lastCentre.x) * nose.x + (centre.y - lastCentre.y) * nose.y + (centre.z - lastCentre.z) * nose.z) / dt;
      lastCentre = { x: centre.x, y: centre.y, z: centre.z };
      const tyreForce = forceWheels.length === 0 ? 0 : withRotatingMass(driveSpec, longitudinalForce(driveSpec, {
        driveForce: spinning.tyreForce,
        intent,
        forwardSpeed: movedAlongNose,
        grip,
        rollingResistance,
        normalForce,
        drivenNormalForce,
        brakeForce: config.brakeForce,
        mass: config.chassis.mass,
        dt,
        externalAlongNose,
      }), externalAlongNose, intent);
      // Only the part of the tyre force that speeds the car up moves load; the part that holds it on
      // a slope is already in the slope term of axleLoadShares.
      accelerationShare = selectable && intent.drive > 0 && weight > 1
        ? Math.max(-1, Math.min(1, (tyreForce + gravityAlongNose) / weight))
        : 0;

      // Rapier caps its engine impulse together with the side grip, so a lower side grip would also
      // cut the drive. The tyre force is applied here instead, at each contact point, along the
      // wheel's heading in the ground plane; Rapier's engine force stays 0.
      const shares = wheelForceShares(forceWheels, isRear, intent.drive > 0 ? rearShare : null);
      const wheelForce = config.wheel.positions.map((_position, wheelIndex) => tyreForce * (shares.get(wheelIndex) ?? 0));
      const headings: { x: number; y: number; z: number }[] = [];
      const axles: { x: number; y: number; z: number }[] = [];
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
        const steer = config.steeredWheels.includes(wheelIndex) ? currentSteer : 0;
        const sine = Math.sin(steer);
        const cosine = Math.cos(steer);
        headings.push({ x: sine * right.x + cosine * nose.x, y: sine * right.y + cosine * nose.y, z: sine * right.z + cosine * nose.z });
        axles.push({ x: cosine * right.x - sine * nose.x, y: cosine * right.y - sine * nose.y, z: cosine * right.z - sine * nose.z });
      }
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
        controller.setWheelEngineForce(wheelIndex, 0);
        const force = wheelForce[wheelIndex];
        if (force === 0) continue;
        const contactPoint = controller.wheelContactPoint(wheelIndex);
        const contactNormal = controller.wheelContactNormal(wheelIndex);
        if (contactPoint === null || contactNormal === null) continue;
        const heading = headings[wheelIndex];
        const intoNormal = heading.x * contactNormal.x + heading.y * contactNormal.y + heading.z * contactNormal.z;
        const along = {
          x: heading.x - contactNormal.x * intoNormal,
          y: heading.y - contactNormal.y * intoNormal,
          z: heading.z - contactNormal.z * intoNormal,
        };
        const length = Math.hypot(along.x, along.y, along.z);
        if (length < 1e-6) continue;
        const impulse = (force * dt) / length;
        body.applyImpulseAtPoint({ x: along.x * impulse, y: along.y * impulse, z: along.z * impulse }, contactPoint, true);
      }

      // Side grip per wheel, set every step: the ground, the slip angle, the spin and the drive on
      // that tyre all change it.
      const angularVelocity = body.angvel();
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
        let angle = 0;
        let lateralSlip = 0;
        const contactPoint = inContact[wheelIndex] ? controller.wheelContactPoint(wheelIndex) : null;
        if (contactPoint !== null) {
          const arm = { x: contactPoint.x - centre.x, y: contactPoint.y - centre.y, z: contactPoint.z - centre.z };
          const pointVelocity = {
            x: velocity.x + angularVelocity.y * arm.z - angularVelocity.z * arm.y,
            y: velocity.y + angularVelocity.z * arm.x - angularVelocity.x * arm.z,
            z: velocity.z + angularVelocity.x * arm.y - angularVelocity.y * arm.x,
          };
          const axleDirection = axles[wheelIndex];
          angle = slipAngle(pointVelocity, headings[wheelIndex], axleDirection);
          lateralSlip = Math.abs(pointVelocity.x * axleDirection.x + pointVelocity.y * axleDirection.y + pointVelocity.z * axleDirection.z);
        }
        const load = controller.wheelSuspensionForce(wheelIndex) ?? 0;
        const wheelSpin = drivenWheels.includes(wheelIndex) ? spin : 0;
        const side = sideGrip({
          configFrictionSlip: config.wheel.frictionSlip,
          grip,
          lateralFactor: ground.lateralFactor,
          looseness: ground.looseness,
          rear: isRear[wheelIndex],
          tailLooseness: config.surface.tailLooseness,
          slipAngle: angle,
          lateralSlipSpeed: lateralSlip,
          spin: wheelSpin,
          usedFriction: load > 1 ? wheelForce[wheelIndex] / load : 0,
          scrubLoss: config.steeredWheels.includes(wheelIndex) ? scrub * LOCKED_CENTRE_SCRUB.frontSideGripLoss : 0,
        });
        controller.setWheelFrictionSlip(wheelIndex, side.frictionSlip);
        controller.setWheelSideFrictionStiffness(wheelIndex, side.stiffness);
        telemetry[wheelIndex] = { sink: sink[wheelIndex], slipAngle: angle, spinSpeed: wheelSpin, lateralSlip };
      }

      // Sinkage per wheel. A shorter wheel radius lowers the car for real, so a deep wheel puts the
      // belly on the sand; a wheel in the air keeps its depth.
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
        if (!inContact[wheelIndex]) continue;
        const next = sinkStep({
          sink: sink[wheelIndex],
          digDirection: digDirection[wheelIndex],
          softness: ground.softness,
          flotation: config.surface.flotation,
          speed: alongNose,
          moving,
          spin: drivenWheels.includes(wheelIndex) ? spin : 0,
          driveDirection: spinDirection,
          radius,
          dt,
        });
        sink[wheelIndex] = next.sink;
        digDirection[wheelIndex] = next.digDirection;
        telemetry[wheelIndex].sink = next.sink;
        controller.setWheelRadius(wheelIndex, radius - next.sink);
      }
      bellyCollider.setFriction(ground.softness > 0 ? SURFACE_TYRE.bellyFriction : config.friction);

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
      let target = -input.steer * steerLimitAt(config, wheelbase, Math.abs(alongNose));
      if (contacts >= 2) {
        target = countersteer(target, bodySlipOf(velocity, nose, alongNose), Math.hypot(velocity.x, velocity.z), config.maxSteer);
      }
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
      resetSurface();
    },
    wheelSurface(): readonly WheelSurface[] {
      return telemetry.map((wheel) => ({ ...wheel }));
    },
    wheelSurfaceSpeed(): number {
      return forwardSpeed() + spinDirection * spin;
    },
    spin(): number {
      return spin;
    },
    wheelLoadShare(): number {
      return loadShare;
    },
    surfaceState(): SurfaceState {
      return { spin, spinDirection, sink: [...sink], digDirection: [...digDirection] };
    },
    setSurfaceState(state: SurfaceState) {
      if (state.sink.length !== wheelCount || state.digDirection.length !== wheelCount) {
        throw new Error(`setSurfaceState: expected ${wheelCount} wheels, got sink ${state.sink.length}, digDirection ${state.digDirection.length}`);
      }
      lastCentre = null;
      spin = Math.min(SURFACE_TYRE.maxSpin, Math.max(0, state.spin));
      spinDirection = state.spinDirection;
      for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex++) {
        sink[wheelIndex] = Math.min(maxSink, Math.max(0, state.sink[wheelIndex]));
        digDirection[wheelIndex] = state.digDirection[wheelIndex];
        telemetry[wheelIndex].sink = sink[wheelIndex];
        controller.setWheelRadius(wheelIndex, radius - sink[wheelIndex]);
      }
    },
    resetSurface,
    driveState(): DriveState {
      const drive: DriveModeState = driveMode !== null && requestedMode !== null
        ? { kind: 'selectable', mode: driveMode, requested: requestedMode, blocked: driveModeBlock }
        : { kind: 'fixed', layout: config.driveLayout.kind };
      return { drive, tractionControl };
    },
  };
}
