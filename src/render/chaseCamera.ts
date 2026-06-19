// src/render/chaseCamera.ts
import * as THREE from 'three';

export class ChaseCamera {
  private current = new THREE.Vector3(0, 40, 60);
  constructor(private camera: THREE.PerspectiveCamera) {}

  update(target: THREE.Object3D) {
    // Desired position: behind and above the target, in its local frame.
    const offset = new THREE.Vector3(0, 9, -18).applyQuaternion(target.quaternion);
    const desired = target.position.clone().add(offset);
    this.current.lerp(desired, 0.12);
    this.camera.position.copy(this.current);
    const lookAt = target.position.clone().add(new THREE.Vector3(0, 2, 0));
    this.camera.lookAt(lookAt);
  }
}
