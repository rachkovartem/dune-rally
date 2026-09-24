// src/render/buggyMesh.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildBuggyMesh } from './buggyMesh';
import { vehicleConfig as cfg } from '../vehicle/vehicleConfig';

describe('buildBuggyMesh() — rig contract Buggy.ts depends on (baseline, R49-R51)', () => {
  it('returns a Group of exactly 5 children: one body and four wheel pivots', () => {
    // Buggy.ts does `this.wheelPivots = this.mesh.children.slice(1)` — a missing or extra
    // child would silently break steering/suspension for whichever wheel index it lands on.
    const group = buildBuggyMesh();
    expect(group.children.length).toBe(5);
  });

  it('positions children[1..4] at cfg.wheel.positions[0..3], in FL/FR/RL/RR order', () => {
    // Buggy.update() resets each pivot's position every frame from the physics wheel index, so
    // a pivot built at the wrong position, or in the wrong order, would visually detach a wheel
    // from the axle the physics controller believes it is driving.
    const group = buildBuggyMesh();
    const wheelPivots = group.children.slice(1);
    expect(wheelPivots.length).toBe(cfg.wheel.positions.length);
    wheelPivots.forEach((pivot, wheelIndex) => {
      const expectedPosition = cfg.wheel.positions[wheelIndex];
      expect(pivot.position.x).toBeCloseTo(expectedPosition.x, 10);
      expect(pivot.position.y).toBeCloseTo(expectedPosition.y, 10);
      expect(pivot.position.z).toBeCloseTo(expectedPosition.z, 10);
    });
  });

  it('does not place the body group at any wheel pivot position', () => {
    // Buggy.ts trusts children[0] unconditionally as the body. A body built at a wheel's own
    // position would be indistinguishable from a pivot to anything reading children[0].
    const group = buildBuggyMesh();
    const body = group.children[0];
    for (const wheelPosition of cfg.wheel.positions) {
      const matchesAWheelPosition =
        Math.abs(body.position.x - wheelPosition.x) < 1e-6 &&
        Math.abs(body.position.y - wheelPosition.y) < 1e-6 &&
        Math.abs(body.position.z - wheelPosition.z) < 1e-6;
      expect(matchesAWheelPosition).toBe(false);
    }
  });

  it('gives every wheel pivot exactly one spinner child that carries the wheel geometry', () => {
    // Buggy.update() reads `pivot.children[0]` as the spinner and rotates it for rolling
    // (`spinner.rotation.x = this.rollAngle`). A pivot with no spinner, or with the wheel
    // meshes attached directly to the pivot instead of the spinner, would make the wheel steer
    // but never visibly roll.
    const group = buildBuggyMesh();
    const wheelPivots = group.children.slice(1);
    for (const pivot of wheelPivots) {
      expect(pivot.children.length).toBe(1);
      const spinner = pivot.children[0];
      expect(spinner).toBeInstanceOf(THREE.Object3D);
      expect(spinner.children.length).toBeGreaterThan(0);
    }
  });
});
