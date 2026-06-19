// src/render/buggyMesh.ts
import * as THREE from 'three';
import { makeToonMaterial } from './celShading';
import { vehicleConfig as cfg } from '../vehicle/vehicleConfig';

export function buildBuggyMesh(): THREE.Group {
  const group = new THREE.Group();
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.chassis.hx * 2, cfg.chassis.hy * 2, cfg.chassis.hz * 2),
    makeToonMaterial(0xff8a3d),
  );
  group.add(chassis);
  for (const _ of cfg.wheel.positions) {
    const w = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.wheel.radius, cfg.wheel.radius, 0.4, 16),
      makeToonMaterial(0x222222),
    );
    w.rotation.z = Math.PI / 2;
    group.add(w);
  }
  return group;
}
