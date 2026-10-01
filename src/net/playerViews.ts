// src/net/playerViews.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildBuggyMesh } from '../render/buggyMesh';
import { TransformBuffer } from './interpolation';
import type { NetPlayer } from './connection';
import type { CarId } from '../vehicle/cars';
import { restingSuspensionLength, vehicleConfigFor, type VehicleConfig } from '../vehicle/vehicleConfig';
import { sanitizeCarId } from '../../shared/protocol';
import { VEHICLE_COLLISION_GROUPS } from '../../shared/vehiclePhysics';

/** Height of the drawn ground at a world point; the same surface the chunk colliders are built from. */
export type GroundHeight = (x: number, z: number) => number;

// The JS values of RAPIER.QueryFilterFlags in 0.13.1 do not match the engine's bits (ONLY_FIXED
// drops the fixed colliders and keeps the dynamic ones), so the choice is made on the body itself.
function isStaticGround(collider: RAPIER.Collider): boolean {
  const body = collider.parent();
  return body === null || body.isFixed();
}

interface View {
  group: THREE.Group;
  wheelPivots: THREE.Group[];
  body: RAPIER.RigidBody;
  buffer: TransformBuffer;
  carId: CarId;
  config: VehicleConfig;
  restingLength: number;
  rollAngle: number;
  /** Where the car was drawn last frame; null until it has been drawn once. */
  lastPosition: THREE.Vector3 | null;
  lastSampleTime?: number;
  lastTargetPos?: { x: number; y: number; z: number };
}

function wheelPivotsOf(group: THREE.Group): THREE.Group[] {
  return group.children.slice(1).map((child) => {
    if (!(child instanceof THREE.Group)) throw new Error('PlayerViews: a wheel pivot of the car mesh is not a Group');
    return child;
  });
}

export class PlayerViews {
  private views = new Map<string, View>();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly connectionPoint = new THREE.Vector3();
  private readonly down = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly travel = new THREE.Vector3();

  /**
   * `world` is used for wheel ground rays and to maintain kinematic colliders for remote vehicles
   * so the local car collides realistically with other players instead of passing through them.
   */
  constructor(
    private scene: THREE.Scene,
    private world: RAPIER.World,
    private groundHeight?: GroundHeight,
    /** The car a player's pick is drawn as: another one when this machine has no model for it. */
    private drawnCarFor: (carId: CarId) => CarId = (carId) => carId,
  ) {}

  private createCollidersForBody(body: RAPIER.RigidBody, config: VehicleConfig): void {
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(config.chassis.hx, config.chassis.hy, config.chassis.hz)
        .setTranslation(0, config.chassis.offsetY, 0)
        .setDensity(0)
        .setRestitution(config.restitution)
        .setFriction(config.friction)
        .setCollisionGroups(VEHICLE_COLLISION_GROUPS),
      body,
    );
    const overhang = config.chassis.overhang;
    if (overhang) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(config.chassis.hx, overhang.hy, overhang.hz)
          .setTranslation(0, overhang.offsetY, 0)
          .setDensity(0)
          .setRestitution(config.restitution)
          .setFriction(config.friction)
          .setCollisionGroups(VEHICLE_COLLISION_GROUPS),
        body,
      );
    }
  }

  private createDynamicBody(
    x: number, y: number, z: number,
    config: VehicleConfig,
    qx = 0, qy = 0, qz = 0, qw = 1,
  ): RAPIER.RigidBody {
    return this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: qx, y: qy, z: qz, w: qw })
        .setLinearDamping(config.linearDamping)
        .setAngularDamping(config.angularDamping)
        .setGravityScale(0)
        .setCanSleep(false)
        .setAdditionalMassProperties(
          config.chassis.mass,
          config.com,
          config.inertia,
          { x: 0, y: 0, z: 0, w: 1 },
        ),
    );
  }

  add(id: string, pickedCarId: CarId): void {
    if (this.views.has(id)) return;
    const carId = this.drawnCarFor(pickedCarId);
    const group = buildBuggyMesh(carId);
    this.scene.add(group);
    const config = vehicleConfigFor(carId);
    const body = this.createDynamicBody(0, -1000, 0, config);
    this.createCollidersForBody(body, config);
    this.views.set(id, {
      group,
      wheelPivots: wheelPivotsOf(group),
      body,
      buffer: new TransformBuffer(),
      carId,
      config,
      restingLength: restingSuspensionLength(config.wheel),
      rollAngle: 0,
      lastPosition: null,
    });
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    this.world.removeRigidBody(v.body);
    this.views.delete(id);
  }

  pushState(id: string, p: NetPlayer, t: number): void {
    const v = this.views.get(id);
    if (!v) return;
    const carId = this.drawnCarFor(sanitizeCarId(p.carId));
    if (carId !== v.carId) this.rebuild(v, carId);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return;
    if (!Number.isFinite(p.qx) || !Number.isFinite(p.qy) || !Number.isFinite(p.qz) || !Number.isFinite(p.qw)) return;
    v.buffer.push({ t, x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw });
  }

  /** The player picked another car: swap the model, keep its motion history. */
  private rebuild(view: View, carId: CarId): void {
    const group = buildBuggyMesh(carId);
    group.position.copy(view.group.position);
    group.quaternion.copy(view.group.quaternion);
    this.scene.remove(view.group);
    this.scene.add(group);
    view.group = group;
    view.wheelPivots = wheelPivotsOf(group);
    view.carId = carId;
    view.config = vehicleConfigFor(carId);
    view.restingLength = restingSuspensionLength(view.config.wheel);

    this.world.removeRigidBody(view.body);
    const body = this.createDynamicBody(
      group.position.x, group.position.y, group.position.z,
      view.config,
      group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w,
    );
    this.createCollidersForBody(body, view.config);
    view.body = body;
    view.lastSampleTime = undefined;
    view.lastTargetPos = undefined;
  }

  /**
   * Remote players are sampled at `renderTime` (a little in the past) for smoothness; the local
   * player is sampled at `localTime` (latest) so own driving feels responsive on low latency.
   * Remote dynamic bodies are updated with continuous velocity for realistic momentum transfer.
   */
  update(renderTime: number, localId: string | null, localTime: number): void {
    for (const [id, v] of this.views) {
      const isLocal = id === localId;
      const targetTime = isLocal ? localTime : renderTime;
      const s = v.buffer.sample(targetTime, isLocal ? 0 : 250);
      v.group.position.set(s.x, s.y, s.z);
      v.group.quaternion.set(s.qx, s.qy, s.qz, s.qw);
      v.group.updateMatrixWorld();

      if (!isLocal) {
        let vx = 0;
        let vy = 0;
        let vz = 0;
        if (v.lastSampleTime !== undefined && v.lastTargetPos !== undefined) {
          const dt = Math.max(0.001, (targetTime - v.lastSampleTime) / 1000);
          if (dt < 0.5) {
            vx = (s.x - v.lastTargetPos.x) / dt;
            vy = (s.y - v.lastTargetPos.y) / dt;
            vz = (s.z - v.lastTargetPos.z) / dt;
            const speed = Math.hypot(vx, vy, vz);
            const maxSpeed = v.config.drivetrain.topSpeed * 1.5;
            if (speed > maxSpeed) {
              const scale = maxSpeed / speed;
              vx *= scale;
              vy *= scale;
              vz *= scale;
            }
          }
        }
        v.lastSampleTime = targetTime;
        v.lastTargetPos = { x: s.x, y: s.y, z: s.z };

        v.body.setTranslation({ x: s.x, y: s.y, z: s.z }, true);
        v.body.setRotation({ x: s.qx, y: s.qy, z: s.qz, w: s.qw }, true);
        v.body.setLinvel({ x: vx, y: vy, z: vz }, true);
        v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }

      this.placeWheels(v);
    }
  }

  bodyOf(id: string): RAPIER.RigidBody | undefined {
    return this.views.get(id)?.body;
  }

  destroy(): void {
    for (const [id] of this.views) {
      this.remove(id);
    }
  }

  /**
   * The server sends only the body's pose, so each wheel is put where the car's own suspension
   * would hold it: on the ground found by a ray (or by `groundHeight` where no collider is built),
   * or at its resting pose when the ground is out of the wheel's reach.
   */
  private placeWheels(view: View): void {
    const { config, group } = view;
    this.forward.set(0, 0, 1).applyQuaternion(group.quaternion);
    if (view.lastPosition) {
      const forwardDistance = this.forward.dot(this.travel.copy(group.position).sub(view.lastPosition));
      view.rollAngle += forwardDistance / config.wheel.radius;
      view.lastPosition.copy(group.position);
    } else {
      view.lastPosition = group.position.clone();
    }

    this.down.set(0, -1, 0).applyQuaternion(group.quaternion);
    const reach = config.wheel.suspensionRestLength + config.wheel.radius;
    const shortest = config.wheel.suspensionRestLength - config.wheel.maxSuspensionTravel;
    for (let wheelIndex = 0; wheelIndex < view.wheelPivots.length; wheelIndex++) {
      const connection = config.wheel.positions[wheelIndex];
      this.connectionPoint.set(connection.x, connection.y, connection.z);
      group.localToWorld(this.connectionPoint);
      this.ray.origin = { x: this.connectionPoint.x, y: this.connectionPoint.y, z: this.connectionPoint.z };
      this.ray.dir = { x: this.down.x, y: this.down.y, z: this.down.z };
      // Fixed colliders only: the ground and buildings, never the local player's own car.
      const hit = this.world.castRay(this.ray, reach, true, undefined, undefined, undefined, undefined, isStaticGround);
      const groundDistance = hit ? hit.timeOfImpact : this.distanceToDrawnGround(reach);
      const suspension = groundDistance === null
        ? view.restingLength
        : Math.min(config.wheel.suspensionRestLength, Math.max(shortest, groundDistance - config.wheel.radius));

      const pivot = view.wheelPivots[wheelIndex];
      pivot.position.set(connection.x, connection.y - suspension, connection.z);
      pivot.children[0].rotation.x = view.rollAngle;
    }
  }

  /**
   * Distance along the wheel ray (from `connectionPoint`, direction `down`) to the drawn ground,
   * or null when it is beyond `reach` or the ray does not point downward. A start point already
   * under the ground counts as 0, as a solid ray cast would report it.
   */
  private distanceToDrawnGround(reach: number): number | null {
    if (!this.groundHeight || this.down.y >= 0) return null;
    const ground = this.groundHeight(this.connectionPoint.x, this.connectionPoint.z);
    const distance = (ground - this.connectionPoint.y) / this.down.y;
    return distance <= reach ? Math.max(0, distance) : null;
  }

  carIdOf(id: string): CarId | undefined {
    return this.views.get(id)?.carId;
  }

  group(id: string): THREE.Group | undefined {
    return this.views.get(id)?.group;
  }
}
