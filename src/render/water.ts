// src/render/water.ts
import * as THREE from 'three';

/**
 * A large flat translucent plane at the world's water level that follows the player. Terrain that
 * dips below the level reads as lakes/seas in the canyons; higher ground occludes it (depth test).
 */
export class Water {
  private mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, private level: number) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x2f6f8f, transparent: true, opacity: 0.62, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat);
    this.mesh.rotation.x = -Math.PI / 2; // lie flat
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);
  }

  update(x: number, z: number): void {
    this.mesh.position.set(x, this.level, z);
  }
}
