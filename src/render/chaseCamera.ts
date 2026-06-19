// src/render/chaseCamera.ts
import * as THREE from 'three';

export class ChaseCamera {
  private current = new THREE.Vector3(0, 40, 60);

  /**
   * @param groundHeight optional terrain sampler; when provided the camera is kept above
   *        the terrain at its own XZ so it never clips below the surface.
   */
  constructor(
    private camera: THREE.PerspectiveCamera,
    private groundHeight?: (x: number, z: number) => number,
  ) {}

  update(target: THREE.Object3D) {
    // Desired position: behind and above the target, in its local frame.
    const offset = new THREE.Vector3(0, 9, -18).applyQuaternion(target.quaternion);
    const desired = target.position.clone().add(offset);
    this.current.lerp(desired, 0.12);

    // Never let the camera dip below the ground it is over.
    if (this.groundHeight) {
      const minY = this.groundHeight(this.current.x, this.current.z) + 4;
      if (this.current.y < minY) this.current.y = minY;
    }

    this.camera.position.copy(this.current);
    const lookAt = target.position.clone().add(new THREE.Vector3(0, 2, 0));
    this.camera.lookAt(lookAt);
  }
}
