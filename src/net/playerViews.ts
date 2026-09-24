// src/net/playerViews.ts
import * as THREE from 'three';
import { buildBuggyMesh } from '../render/buggyMesh';
import { TransformBuffer } from './interpolation';
import type { NetPlayer } from './connection';
import type { CarId } from '../vehicle/cars';
import { sanitizeCarId } from '../../shared/protocol';

interface View { group: THREE.Group; buffer: TransformBuffer; carId: CarId }

export class PlayerViews {
  private views = new Map<string, View>();
  constructor(private scene: THREE.Scene) {}

  add(id: string, carId: CarId): void {
    if (this.views.has(id)) return;
    const group = buildBuggyMesh(carId);
    this.scene.add(group);
    this.views.set(id, { group, buffer: new TransformBuffer(), carId });
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
    view.carId = carId;
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
    }
  }

  carIdOf(id: string): CarId | undefined {
    return this.views.get(id)?.carId;
  }

  group(id: string): THREE.Group | undefined {
    return this.views.get(id)?.group;
  }
}
