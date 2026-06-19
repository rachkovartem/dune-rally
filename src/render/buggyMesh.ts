// src/render/buggyMesh.ts
import * as THREE from 'three';
import { makeToonMaterial } from './celShading';
import { vehicleConfig as cfg } from '../vehicle/vehicleConfig';

const BODY = 0x3a5a40;  // dark forest green
const GLASS = 0x232c33; // tinted windows
const TRIM = 0x161616;  // bumpers / arches / rails
const LIGHT = 0xffe9a0; // headlights

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeToonMaterial(color));
}

/**
 * Low-poly mid-size SUV (Pajero-Sport-ish). Front is +Z (drive/forward direction).
 * Group layout is [bodyGroup, wheelPivot0..3] so the physics Buggy can read children[0] as the
 * body and children.slice(1) as the wheel pivots. Each wheel pivot (steers via yaw) holds a
 * spinner (rolls around the axle) holding the tyre.
 */
export function buildBuggyMesh(): THREE.Group {
  const group = new THREE.Group();
  const b = new THREE.Group(); // body

  const lower = box(2.0, 0.7, 4.0, BODY);
  lower.position.y = 0.15;
  b.add(lower);

  const hood = box(1.82, 0.38, 1.4, BODY); // front, lower than the cabin
  hood.position.set(0, 0.5, 1.3);
  b.add(hood);

  const cabin = box(1.86, 0.72, 2.0, BODY); // greenhouse, raised, toward the rear
  cabin.position.set(0, 0.85, -0.3);
  b.add(cabin);

  const glass = box(1.9, 0.46, 2.04, GLASS); // window band inset on the cabin
  glass.position.set(0, 0.95, -0.3);
  b.add(glass);

  const roof = box(1.78, 0.2, 1.9, BODY);
  roof.position.set(0, 1.28, -0.35);
  b.add(roof);

  for (const sx of [-1, 1]) {
    const rail = box(0.08, 0.12, 1.7, TRIM);
    rail.position.set(sx * 0.76, 1.42, -0.35);
    b.add(rail);
  }

  const frontBumper = box(2.05, 0.5, 0.4, TRIM);
  frontBumper.position.set(0, 0.28, 2.05);
  b.add(frontBumper);

  const rearBumper = box(2.05, 0.5, 0.4, TRIM);
  rearBumper.position.set(0, 0.28, -2.05);
  b.add(rearBumper);

  for (const sx of [-1, 1]) {
    const light = box(0.42, 0.22, 0.12, LIGHT);
    light.position.set(sx * 0.62, 0.56, 2.02);
    b.add(light);
  }

  // wheel-arch flares over each wheel
  for (const p of cfg.wheel.positions) {
    const arch = box(0.56, 0.6, 1.15, TRIM);
    arch.position.set(p.x * 1.03, -0.02, p.z);
    b.add(arch);
  }

  b.position.y = -0.1;
  group.add(b);

  for (const p of cfg.wheel.positions) {
    const pivot = new THREE.Group(); // position + steering yaw
    pivot.position.set(p.x, p.y, p.z);
    const spinner = new THREE.Group(); // rolls around the axle (local X)
    const tyre = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.wheel.radius, cfg.wheel.radius, cfg.wheel.width, 18),
      makeToonMaterial(0x141414),
    );
    tyre.rotation.z = Math.PI / 2;
    spinner.add(tyre);
    pivot.add(spinner);
    group.add(pivot);
  }

  return group;
}
