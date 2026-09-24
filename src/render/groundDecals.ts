// src/render/groundDecals.ts
import * as THREE from 'three';
import type { Height2D } from '../world/noise';
import { terrainSurfaceHeight } from '../world/chunkGeometry';

const CAP = 900;       // ribs per ribbon (ring buffer) → trail length ≈ CAP * STEP
const STEP = 0.3;      // min distance between ribs (denser → conforms to bumps)
const HALF_W = 0.24;   // half tyre width (ribbon half-width)
const WHEEL_X = 1.0;   // half rear-track (left/right wheel offset)
const REAR = 1.4;      // distance behind centre to the rear axle
// A small POSITIVE offset, not the sunken negative one the plan first suggested: a few cm below
// the surface reliably loses the z-test against the terrain at this camera distance even with
// polygon offset (verified on screen — the ribbon vanished behind the ground). The pressed-in
// groove read comes from the darker, grain-modulated material instead of true depth.
const SURFACE_OFFSET = 0.008;

/** Rut material shared by both ribbons: darker, disturbed sand. The polygon offset keeps the
 * ribbon on top of the terrain it lies on. */
function createRutMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x8a7455,
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/**
 * One continuous ribbon ("trail") following a wheel. Each rib is a 2-vertex cross-segment
 * placed on the terrain surface; consecutive ribs are joined into quads so the strip is gapless
 * and hugs the ground. Ring buffer: the oldest rib is overwritten once CAP is reached.
 */
class Ribbon {
  private geom = new THREE.BufferGeometry();
  private pos = new Float32Array(CAP * 2 * 3);
  // One pre-allocated index buffer, written in place and revealed with setDrawRange, so adding
  // a rib never allocates a new GPU buffer.
  private indexArray = new Uint32Array((CAP - 1) * 6);
  private indexAttribute: THREE.BufferAttribute;
  private count = 0;

  constructor(scene: THREE.Scene, mat: THREE.Material, private surfaceAt: (x: number, z: number) => number) {
    const attr = new THREE.BufferAttribute(this.pos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', attr);
    // A ground-hugging ribbon is flat enough that a constant up-normal reads fine, and it avoids
    // recomputing normals from a geometry that changes every frame.
    const normals = new Float32Array(CAP * 2 * 3);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    this.geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    // Across-the-ribbon UV only; no current material reads it. The Step B rut normal map will
    // also need the along-track coordinate.
    const uvs = new Float32Array(CAP * 2 * 2);
    for (let i = 1; i < uvs.length; i += 2) uvs[i] = 1;
    this.geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.indexAttribute = new THREE.BufferAttribute(this.indexArray, 1);
    this.indexAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geom.setIndex(this.indexAttribute);
    this.geom.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(this.geom, mat);
    mesh.frustumCulled = false; // vertices move every frame; don't cull on a stale bound
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
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
    this.pos[vL * 3 + 1] = this.surfaceAt(lx, lz) + SURFACE_OFFSET;
    this.pos[vL * 3 + 2] = lz;
    this.pos[vR * 3] = px;
    this.pos[vR * 3 + 1] = this.surfaceAt(px, pz) + SURFACE_OFFSET;
    this.pos[vR * 3 + 2] = pz;
    this.count++;
    this.rebuildIndex();
    this.geom.attributes.position.needsUpdate = true;
  }

  private rebuildIndex(): void {
    const n = Math.min(this.count, CAP);
    if (n < 2) { this.geom.setDrawRange(0, 0); return; }
    const start = this.count <= CAP ? 0 : this.count % CAP; // oldest rib slot
    let o = 0;
    for (let k = 0; k < n - 1; k++) {
      const a = (start + k) % CAP;
      const b = (start + k + 1) % CAP;
      const aL = a * 2;
      const aR = a * 2 + 1;
      const bL = b * 2;
      const bR = b * 2 + 1;
      this.indexArray[o++] = aL; this.indexArray[o++] = bL; this.indexArray[o++] = aR;
      this.indexArray[o++] = aR; this.indexArray[o++] = bL; this.indexArray[o++] = bR;
    }
    this.indexAttribute.needsUpdate = true;
    this.geom.setDrawRange(0, o);
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
    const mat = createRutMaterial();
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
