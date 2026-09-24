// src/render/water.ts
import * as THREE from 'three/webgpu';
import { createWaterMaterial } from './waterMaterial';

/**
 * A large flat plane at the world's water level that follows the player. Terrain that dips below
 * the level reads as the lake (higher ground occludes it via the depth test); the material gives
 * it an IBL sky reflection, a scrolling ripple normal and Fresnel opacity — see waterMaterial.ts.
 */
export class Water {
  private mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, private level: number, environment: THREE.Texture, sunDirection: THREE.Vector3) {
    const material = createWaterMaterial(environment, sunDirection);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), material);
    this.mesh.rotation.x = -Math.PI / 2; // lie flat
    this.mesh.renderOrder = 1; // after the opaque terrain
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  update(x: number, z: number): void {
    this.mesh.position.set(x, this.level, z);
  }
}
