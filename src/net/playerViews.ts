// src/net/playerViews.ts
import * as THREE from 'three';
import { buildBuggyMesh } from '../render/buggyMesh';
import { TransformBuffer } from './interpolation';
import type { NetPlayer } from './connection';

interface View { group: THREE.Group; buffer: TransformBuffer }

export class PlayerViews {
  private views = new Map<string, View>();
  constructor(private scene: THREE.Scene) {}

  add(id: string): void {
    if (this.views.has(id)) return;
    const group = buildBuggyMesh();
    this.scene.add(group);
    this.views.set(id, { group, buffer: new TransformBuffer() });
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    this.views.delete(id);
  }

  pushState(id: string, p: NetPlayer, t: number): void {
    const v = this.views.get(id);
    if (v) v.buffer.push({ t, x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw });
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

  group(id: string): THREE.Group | undefined {
    return this.views.get(id)?.group;
  }
}
