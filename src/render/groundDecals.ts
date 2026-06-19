// src/render/groundDecals.ts
import * as THREE from 'three';
import type { Height2D } from '../world/noise';

// Lay a flat plane on the ground, yawed to a heading (the plane's local +Y runs along travel).
function laydown(mesh: THREE.Object3D, x: number, y: number, z: number, yaw: number): void {
  mesh.position.set(x, y, z);
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  mesh.quaternion.copy(yawQ).multiply(flat);
}

function headingOf(obj: THREE.Object3D): { yaw: number; fwd: THREE.Vector3; right: THREE.Vector3 } {
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
  return { yaw: Math.atan2(fwd.x, fwd.z), fwd, right };
}

/**
 * Tyre tracks: a ring-buffer pool of flat dark marks dropped behind the rear wheels as the car
 * drives. Marks rest on the terrain surface (sampled height) and reuse the oldest when full.
 */
export class TireTracks {
  private marks: THREE.Mesh[] = [];
  private idx = 0;
  private lastX = 0;
  private lastZ = 0;
  private started = false;

  private static readonly MAX = 280;
  private static readonly SPACING = 1.0;   // world units between dropped rows
  private static readonly REAR = 1.5;      // distance behind centre to the rear axle
  private static readonly HALF = 0.95;     // half track width (left/right wheel offset)

  constructor(scene: THREE.Scene, private height: Height2D) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2c1d0f, transparent: true, opacity: 0.42, depthWrite: false,
    });
    mat.userData.outlineParameters = { visible: false };
    const geo = new THREE.PlaneGeometry(0.34, 1.25);
    for (let i = 0; i < TireTracks.MAX; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 1;
      scene.add(m);
      this.marks.push(m);
    }
  }

  update(car: THREE.Object3D, speed: number): void {
    const pos = car.position;
    if (!this.started) {
      this.lastX = pos.x;
      this.lastZ = pos.z;
      this.started = true;
      return;
    }
    const dx = pos.x - this.lastX;
    const dz = pos.z - this.lastZ;
    if (speed < 1.5 || dx * dx + dz * dz < TireTracks.SPACING * TireTracks.SPACING) return;
    this.lastX = pos.x;
    this.lastZ = pos.z;

    const { yaw, fwd, right } = headingOf(car);
    const rearX = pos.x - fwd.x * TireTracks.REAR;
    const rearZ = pos.z - fwd.z * TireTracks.REAR;
    for (const s of [-1, 1]) {
      const x = rearX + right.x * TireTracks.HALF * s;
      const z = rearZ + right.z * TireTracks.HALF * s;
      const m = this.marks[this.idx];
      this.idx = (this.idx + 1) % TireTracks.MAX;
      laydown(m, x, this.height(x, z) + 0.06, z, yaw);
      m.visible = true;
    }
  }
}

/** A soft blob shadow that follows the car along the ground (cheap, stylised). */
export class BlobShadow {
  private mesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
    });
    mat.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 4.8), mat);
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  update(car: THREE.Object3D, height: Height2D): void {
    const p = car.position;
    const { yaw, fwd } = headingOf(car);
    // Nudge the shadow slightly away from the sun (sun is up-and-front-right) so it reads cast.
    const x = p.x - fwd.x * 0.3 - 0.4;
    const z = p.z - fwd.z * 0.3 - 0.4;
    laydown(this.mesh, x, height(x, z) + 0.05, z, yaw);
  }
}
