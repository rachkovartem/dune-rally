// src/net/playerViews.ts
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildBuggyMesh } from '../render/buggyMesh';
import { TransformBuffer } from './interpolation';
import type { NetPlayer } from './connection';
import type { CarId } from '../vehicle/cars';
import { restingSuspensionLength, vehicleConfigFor, type VehicleConfig } from '../vehicle/vehicleConfig';
import { sanitizeCarId } from '../../shared/protocol';

interface View {
  group: THREE.Group;
  wheelPivots: THREE.Group[];
  buffer: TransformBuffer;
  carId: CarId;
  config: VehicleConfig;
  restingLength: number;
  rollAngle: number;
  /** Where the car was drawn last frame; null until it has been drawn once. */
  lastPosition: THREE.Vector3 | null;
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

  /** `world` is only read: the remote wheels cast rays against the ground to find where to stand. */
  constructor(private scene: THREE.Scene, private world: RAPIER.World) {}

  add(id: string, carId: CarId): void {
    if (this.views.has(id)) return;
    const group = buildBuggyMesh(carId);
    this.scene.add(group);
    const config = vehicleConfigFor(carId);
    this.views.set(id, {
      group,
      wheelPivots: wheelPivotsOf(group),
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
    this.views.delete(id);
  }

  pushState(id: string, p: NetPlayer, t: number): void {
    const v = this.views.get(id);
    if (!v) return;
    const carId = sanitizeCarId(p.carId);
    if (carId !== v.carId) this.rebuild(v, carId);
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
  }

  /**
   * Remote players are sampled at `renderTime` (a little in the past) for smoothness; the local
   * player is sampled at `localTime` (latest) so own driving feels responsive on low latency.
   */
  update(renderTime: number, localId: string | null, localTime: number): void {
    for (const [id, v] of this.views) {
      const s = v.buffer.sample(id === localId ? localTime : renderTime);
      v.group.position.set(s.x, s.y, s.z);
      v.group.quaternion.set(s.qx, s.qy, s.qz, s.qw);
      v.group.updateMatrixWorld();
      this.placeWheels(v);
    }
  }

  /**
   * The server sends only the body's pose, so each wheel is put where the car's own suspension
   * would hold it: on the ground found by a ray, or at its resting pose when nothing is under it.
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
      const hit = this.world.castRay(this.ray, reach, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
      const suspension = hit
        ? Math.min(config.wheel.suspensionRestLength, Math.max(shortest, hit.timeOfImpact - config.wheel.radius))
        : view.restingLength;

      const pivot = view.wheelPivots[wheelIndex];
      pivot.position.set(connection.x, connection.y - suspension, connection.z);
      pivot.children[0].rotation.x = view.rollAngle;
    }
  }

  carIdOf(id: string): CarId | undefined {
    return this.views.get(id)?.carId;
  }

  group(id: string): THREE.Group | undefined {
    return this.views.get(id)?.group;
  }
}
