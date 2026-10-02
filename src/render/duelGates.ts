// src/render/duelGates.ts
import * as THREE from 'three';
import type { DuelTrackDef } from '../../shared/duelTracks';

/** Height of the drawn ground at a world point. */
export type GroundHeightFn = (x: number, z: number) => number;

export class DuelGates {
  private rootGroup = new THREE.Group();
  private checkpointMeshes: THREE.Group[] = [];
  private beaconBeam: THREE.Mesh | null = null;
  private activeCheckpointIndex = 0;
  private animTime = 0;
  private isBuilt = false;

  constructor(
    private scene: THREE.Scene,
    private groundHeight?: GroundHeightFn,
  ) {
    this.rootGroup.name = 'duel-gates';
    this.scene.add(this.rootGroup);
  }

  buildTrack(track: DuelTrackDef): void {
    this.clear();
    this.isBuilt = true;
    this.activeCheckpointIndex = 0;

    const allPoints = [...track.checkpoints, track.finish];

    for (let i = 0; i < allPoints.length; i++) {
      const cp = allPoints[i];
      const isFinish = i === allPoints.length - 1;
      const y = this.groundHeight ? this.groundHeight(cp.x, cp.z) : 0;

      const group = new THREE.Group();
      group.position.set(cp.x, y, cp.z);

      // Checkpoint ring
      const ringRadius = isFinish ? 6.5 : 5.0;
      const tubeRadius = isFinish ? 0.4 : 0.25;
      const ringGeo = new THREE.TorusGeometry(ringRadius, tubeRadius, 8, 24);
      const ringMat = new THREE.MeshBasicMaterial({
        color: isFinish ? 0xffd23d : 0x00d2ff,
        transparent: true,
        opacity: 0.85,
        wireframe: false,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = ringRadius;
      ringMesh.rotation.x = Math.PI / 2; // Flat on ground or vertical? Let's make it vertical facing path or rotating
      group.add(ringMesh);

      // Inner pulsating disc
      const discGeo = new THREE.CylinderGeometry(ringRadius * 0.95, ringRadius * 0.95, 0.1, 16);
      const discMat = new THREE.MeshBasicMaterial({
        color: isFinish ? 0xffaa00 : 0x00aaff,
        transparent: true,
        opacity: 0.2,
      });
      const discMesh = new THREE.Mesh(discGeo, discMat);
      discMesh.position.y = ringRadius;
      group.add(discMesh);

      this.checkpointMeshes.push(group);
      this.rootGroup.add(group);
    }

    // Sky Beacon: tall luminous cylinder beam
    const beamGeo = new THREE.CylinderGeometry(0.8, 2.5, 200, 12, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.beaconBeam = new THREE.Mesh(beamGeo, beamMat);
    this.beaconBeam.position.y = 100;
    this.rootGroup.add(this.beaconBeam);

    this.updateActiveCheckpoint(0);
  }

  updateActiveCheckpoint(checkpointIndex: number): void {
    this.activeCheckpointIndex = checkpointIndex;

    for (let i = 0; i < this.checkpointMeshes.length; i++) {
      const group = this.checkpointMeshes[i];
      const isPast = i < checkpointIndex;
      const isCurrent = i === checkpointIndex;
      const isFinish = i === this.checkpointMeshes.length - 1;

      group.visible = !isPast;
      if (isCurrent && this.beaconBeam) {
        this.beaconBeam.position.x = group.position.x;
        this.beaconBeam.position.z = group.position.z;
        this.beaconBeam.position.y = group.position.y + 100;
        if (this.beaconBeam.material instanceof THREE.MeshBasicMaterial) {
          this.beaconBeam.material.color.setHex(isFinish ? 0xffd23d : 0x00f0ff);
        }
      }
    }
  }

  update(dt: number): void {
    if (!this.isBuilt) return;
    this.animTime += dt;

    // Rotate current checkpoint ring slowly
    const currentGroup = this.checkpointMeshes[this.activeCheckpointIndex];
    if (currentGroup && currentGroup.visible) {
      const ring = currentGroup.children[0];
      if (ring) {
        ring.rotation.z = this.animTime * 1.5;
      }
    }

    // Pulse beacon opacity
    if (this.beaconBeam && this.beaconBeam.material instanceof THREE.MeshBasicMaterial) {
      this.beaconBeam.material.opacity = 0.35 + 0.15 * Math.sin(this.animTime * 3);
    }
  }

  clear(): void {
    for (const group of this.checkpointMeshes) {
      this.rootGroup.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }
    this.checkpointMeshes = [];

    if (this.beaconBeam) {
      this.rootGroup.remove(this.beaconBeam);
      this.beaconBeam.geometry.dispose();
      if (this.beaconBeam.material instanceof THREE.Material) {
        this.beaconBeam.material.dispose();
      }
      this.beaconBeam = null;
    }

    this.isBuilt = false;
  }

  destroy(): void {
    this.clear();
    this.scene.remove(this.rootGroup);
  }
}
