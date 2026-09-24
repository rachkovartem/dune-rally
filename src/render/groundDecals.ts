// src/render/groundDecals.ts
import * as THREE from 'three';
import type { Height2D } from '../world/noise';
import { terrainSurfaceHeight } from '../world/chunkGeometry';

const CAP = 900;       // ribs per ribbon (ring buffer) → trail length ≈ CAP * STEP
const STEP = 0.3;      // min distance between ribs (denser → conforms to bumps)
const HALF_W = 0.24;   // half tyre width (ribbon half-width)
const WHEEL_X = 1.0;   // half rear-track (left/right wheel offset)
const REAR = 1.4;      // distance behind centre to the rear axle

/**
 * One continuous ribbon ("trail") following a wheel. Each rib is a 2-vertex cross-segment
 * placed on the terrain surface; consecutive ribs are joined into quads so the strip is gapless
 * and hugs the ground. Ring buffer: the oldest rib is overwritten once CAP is reached.
 */
class Ribbon {
  private geom = new THREE.BufferGeometry();
  private pos = new Float32Array(CAP * 2 * 3);
  private count = 0;

  constructor(scene: THREE.Scene, mat: THREE.Material, private surfaceAt: (x: number, z: number) => number) {
    const attr = new THREE.BufferAttribute(this.pos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', attr);
    const mesh = new THREE.Mesh(this.geom, mat);
    mesh.frustumCulled = false; // vertices move every frame; don't cull on a stale bound
    mesh.renderOrder = 1;
    scene.add(mesh);
  }

  addRib(cx: number, cz: number, rx: number, rz: number): void {
    const slot = this.count % CAP;
    const vL = slot * 2;
    const vR = slot * 2 + 1;
    const lx = cx - rx * HALF_W;
    const lz = cz - rz * HALF_W;
    const px = cx + rx * HALF_W;
    const pz = cz + rz * HALF_W;
    this.pos[vL * 3] = lx;
    this.pos[vL * 3 + 1] = this.surfaceAt(lx, lz) + 0.015;
    this.pos[vL * 3 + 2] = lz;
    this.pos[vR * 3] = px;
    this.pos[vR * 3 + 1] = this.surfaceAt(px, pz) + 0.015;
    this.pos[vR * 3 + 2] = pz;
    this.count++;
    this.rebuildIndex();
    this.geom.attributes.position.needsUpdate = true;
  }

  private rebuildIndex(): void {
    const n = Math.min(this.count, CAP);
    if (n < 2) return;
    const start = this.count <= CAP ? 0 : this.count % CAP; // oldest rib slot
    const idx: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      const a = (start + k) % CAP;
      const b = (start + k + 1) % CAP;
      const aL = a * 2;
      const aR = a * 2 + 1;
      const bL = b * 2;
      const bR = b * 2 + 1;
      idx.push(aL, bL, aR, aR, bL, bR);
    }
    this.geom.setIndex(idx);
  }
}

/** Two ground-hugging ribbons laid behind the rear wheels as the car drives. */
export class TireTracks {
  private left: Ribbon;
  private right: Ribbon;
  private lastX = 0;
  private lastZ = 0;
  private started = false;

  constructor(scene: THREE.Scene, height: Height2D) {
    // Opaque + polygonOffset so the track sits on the surface without z-fighting or
    // transparency-sort drop-outs.
    const mat = new THREE.MeshBasicMaterial({ color: 0x5b4226 });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    const surfaceAt = (x: number, z: number) => terrainSurfaceHeight(height, x, z);
    this.left = new Ribbon(scene, mat, surfaceAt);
    this.right = new Ribbon(scene, mat, surfaceAt);
  }

  update(car: THREE.Object3D, speed: number): void {
    const p = car.position;
    if (!this.started) {
      this.lastX = p.x;
      this.lastZ = p.z;
      this.started = true;
      return;
    }
    const dx = p.x - this.lastX;
    const dz = p.z - this.lastZ;
    if (speed < 1.2 || dx * dx + dz * dz < STEP * STEP) return;
    this.lastX = p.x;
    this.lastZ = p.z;

    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion);
    const rl = Math.hypot(right.x, right.z) || 1;
    const rx = right.x / rl;
    const rz = right.z / rl;
    const rearX = p.x - fwd.x * REAR;
    const rearZ = p.z - fwd.z * REAR;
    this.left.addRib(rearX - rx * WHEEL_X, rearZ - rz * WHEEL_X, rx, rz);
    this.right.addRib(rearX + rx * WHEEL_X, rearZ + rz * WHEEL_X, rx, rz);
  }
}
