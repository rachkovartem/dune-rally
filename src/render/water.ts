// src/render/water.ts
import * as THREE from 'three';
import { createWaterMaterial, rippleNormalTexture, WATER_RIPPLE_REPEATS_PER_METRE } from './waterMaterial';

const PLANE_SIZE = 900;
const RIPPLE_SCROLL_PER_SECOND = { u: 0.012, v: 0.007 };

/**
 * A large flat plane at the world's water level that follows the player. Terrain that dips below
 * the level reads as the lake (higher ground occludes it via the depth test).
 */
export class Water {
  private mesh: THREE.Mesh;
  private ripple: THREE.DataTexture;
  private repeats = PLANE_SIZE * WATER_RIPPLE_REPEATS_PER_METRE;

  constructor(scene: THREE.Scene, private level: number) {
    this.ripple = rippleNormalTexture(256, 7);
    this.ripple.repeat.set(this.repeats, this.repeats);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE), createWaterMaterial(this.ripple));
    this.mesh.rotation.x = -Math.PI / 2; // lie flat
    this.mesh.renderOrder = 1; // after the opaque terrain
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  update(x: number, z: number): void {
    this.mesh.position.set(x, this.level, z);
    // The plane follows the player, so the ripple offset moves the other way to stay fixed to
    // the world. The plane's v axis points to world -z after the rotation above.
    const seconds = performance.now() / 1000;
    this.ripple.offset.set(
      (x / PLANE_SIZE) * this.repeats + seconds * RIPPLE_SCROLL_PER_SECOND.u,
      (-z / PLANE_SIZE) * this.repeats + seconds * RIPPLE_SCROLL_PER_SECOND.v,
    );
  }
}
