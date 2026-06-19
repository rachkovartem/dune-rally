// src/render/buggyMesh.ts
import * as THREE from 'three';
import { makeToonMaterial } from './celShading';
import { vehicleConfig as cfg } from '../vehicle/vehicleConfig';

/**
 * A low-poly buggy: a wide body with a raised cabin, and four wheels at the corner
 * positions from vehicleConfig. Group layout is [body, wheel0..wheel3] so the physics
 * Buggy (which reads children[0] as chassis and children.slice(1) as wheels) still works.
 */
export function buildBuggyMesh(): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.chassis.hx * 2, cfg.chassis.hy * 1.3, cfg.chassis.hz * 2),
    makeToonMaterial(0xff7a1f),
  );
  body.position.y = -0.05;

  // Cabin rides on the body (child) so the group's child list stays [body, ...wheels].
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.chassis.hx * 1.5, cfg.chassis.hy * 1.2, cfg.chassis.hz * 0.95),
    makeToonMaterial(0xffd23d),
  );
  cabin.position.set(0, cfg.chassis.hy * 1.0, -cfg.chassis.hz * 0.3);
  body.add(cabin);

  // A dark front bar for a bit of character.
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.chassis.hx * 2.1, 0.25, 0.25),
    makeToonMaterial(0x222222),
  );
  bar.position.set(0, cfg.chassis.hy * 0.4, cfg.chassis.hz * 1.0);
  body.add(bar);

  group.add(body);

  for (const p of cfg.wheel.positions) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.wheel.radius, cfg.wheel.radius, 0.5, 18),
      makeToonMaterial(0x1a1a1a),
    );
    wheel.rotation.z = Math.PI / 2; // axle along X
    wheel.position.set(p.x, p.y, p.z);
    group.add(wheel);
  }

  return group;
}
