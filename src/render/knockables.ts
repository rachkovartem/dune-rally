// src/render/knockables.ts
import * as THREE from 'three';

const KNOCK_R = 2.7;     // how close the car must pass to knock a prop
const MIN_SPEED = 3;     // u/s below which the car can't knock things over
const FALL_RATE = 3.5;   // topple progress per second (≈0.3s to fall)
const MAX_TILT = 1.52;   // radians the prop tips before lying flat (~87°)

interface KnockState {
  fall: number;            // 0 = standing, 1 = flat
  axis?: THREE.Vector3;    // horizontal topple axis
  base?: THREE.Quaternion; // original orientation
}

/**
 * Props (trees, cacti) that topple when the car ploughs through them. Cheap: no rigid bodies —
 * each standing prop near a fast-moving car starts a fixed topple animation around its base in
 * the car's travel direction, then stays down.
 */
export class Knockables {
  private items = new Set<THREE.Object3D>();
  private q = new THREE.Quaternion();

  constructor(private onKnock?: () => void) {}

  add(obj: THREE.Object3D): void {
    (obj.userData as KnockState).fall = 0;
    this.items.add(obj);
  }

  remove(obj: THREE.Object3D): void {
    this.items.delete(obj);
  }

  update(carX: number, carZ: number, fwdX: number, fwdZ: number, speed: number, dt: number): void {
    for (const obj of this.items) {
      const st = obj.userData as KnockState;

      if (st.fall === 0) {
        if (speed < MIN_SPEED) continue;
        const dx = obj.position.x - carX;
        const dz = obj.position.z - carZ;
        if (dx * dx + dz * dz > KNOCK_R * KNOCK_R) continue;
        // begin toppling: tip the top toward the car's travel direction
        const len = Math.hypot(fwdX, fwdZ) || 1;
        const fx = fwdX / len;
        const fz = fwdZ / len;
        st.axis = new THREE.Vector3(fz, 0, -fx); // horizontal, perpendicular to travel
        st.base = obj.quaternion.clone();
        st.fall = 0.0001;
        this.onKnock?.();
      }

      if (st.fall > 0 && st.fall < 1 && st.axis && st.base) {
        st.fall = Math.min(1, st.fall + dt * FALL_RATE);
        this.q.setFromAxisAngle(st.axis, st.fall * MAX_TILT);
        obj.quaternion.copy(this.q).multiply(st.base);
      }
    }
  }
}
