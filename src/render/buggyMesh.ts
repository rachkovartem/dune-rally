// src/render/buggyMesh.ts
import * as THREE from 'three';
import { makeToonMaterial } from './celShading';
import { vehicleConfig as cfg } from '../vehicle/vehicleConfig';

/**
 * A low-poly buggy: body + raised cabin + a front bar, and four wheels at the corner positions.
 *
 * Each wheel is a pivot (positioned + steered by yaw) containing a spinner (rolls around the
 * axle) containing the tyre cylinder. Group layout is [body, wheelPivot0..3] so the physics
 * Buggy can read children[0] as the chassis and children.slice(1) as the wheel pivots.
 */
export function buildBuggyMesh(): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.chassis.hx * 2, cfg.chassis.hy * 1.4, cfg.chassis.hz * 2),
    makeToonMaterial(0xff7a1f),
  );
  body.position.y = -0.05;

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.chassis.hx * 1.5, cfg.chassis.hy * 1.3, cfg.chassis.hz * 0.95),
    makeToonMaterial(0xffd23d),
  );
  cabin.position.set(0, cfg.chassis.hy * 1.05, -cfg.chassis.hz * 0.3);
  body.add(cabin);

  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.chassis.hx * 2.05, 0.22, 0.22),
    makeToonMaterial(0x222222),
  );
  bar.position.set(0, cfg.chassis.hy * 0.4, cfg.chassis.hz * 1.0);
  body.add(bar);

  group.add(body);

  for (const p of cfg.wheel.positions) {
    const pivot = new THREE.Group(); // position + steering yaw
    pivot.position.set(p.x, p.y, p.z);

    const spinner = new THREE.Group(); // rolls around the axle (local X)
    const tyre = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.wheel.radius, cfg.wheel.radius, cfg.wheel.width, 18),
      makeToonMaterial(0x1a1a1a),
    );
    tyre.rotation.z = Math.PI / 2; // lay the cylinder so its axle is along X
    spinner.add(tyre);
    pivot.add(spinner);
    group.add(pivot);
  }

  return group;
}
