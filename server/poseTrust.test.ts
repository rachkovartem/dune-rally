// server/poseTrust.test.ts
// Category 1: how far a driver's pose may move the server copy (release review).
import { describe, it, expect } from 'vitest';
import { plausiblePoseDistance, POSE_SPEED_ALLOWANCE, trustedPose, type PoseCheck } from './poseTrust';
import { POSE_SNAP_DISTANCE } from './arenaSim';
import type { PoseMsg } from '../shared/protocol';

const TOP_SPEED = 40;
const SERVER = { x: 100, y: 20, z: -300 };
const STILL: PoseMsg = { ...SERVER, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0 };

function check(pose: Partial<PoseMsg>, secondsSinceAccepted: number): PoseCheck {
  return { pose: { ...STILL, ...pose }, serverPosition: SERVER, secondsSinceAccepted, topSpeed: TOP_SPEED };
}

describe('plausiblePoseDistance — how far a car could have driven', () => {
  it('never goes below the distance the server snaps at, even with no time passed', () => {
    expect(plausiblePoseDistance({ secondsSinceAccepted: 0, topSpeed: TOP_SPEED })).toBeGreaterThan(POSE_SNAP_DISTANCE);
  });

  it.each([-1, -1000, Number.NEGATIVE_INFINITY])('treats %s seconds (a clock that ran back) like no time at all', (seconds) => {
    expect(plausiblePoseDistance({ secondsSinceAccepted: seconds, topSpeed: TOP_SPEED }))
      .toBe(plausiblePoseDistance({ secondsSinceAccepted: 0, topSpeed: TOP_SPEED }));
  });

  it('grows with the time since the last accepted pose', () => {
    const distances = [1, 2, 5, 10].map((seconds) => plausiblePoseDistance({ secondsSinceAccepted: seconds, topSpeed: TOP_SPEED }));
    for (let index = 1; index < distances.length; index++) expect(distances[index]).toBeGreaterThan(distances[index - 1]);
  });

  it.each([1, 3, 10])('covers a car that drove at its top speed for %s s', (seconds) => {
    expect(plausiblePoseDistance({ secondsSinceAccepted: seconds, topSpeed: TOP_SPEED })).toBeGreaterThan(TOP_SPEED * seconds);
  });

  it('allows a faster car to move further in the same time', () => {
    expect(plausiblePoseDistance({ secondsSinceAccepted: 2, topSpeed: TOP_SPEED * 2 }))
      .toBeGreaterThan(plausiblePoseDistance({ secondsSinceAccepted: 2, topSpeed: TOP_SPEED }));
  });
});

describe('trustedPose — the distance check', () => {
  it.each([0, 0.1, 4])('accepts a pose exactly at the bound after %s s', (seconds) => {
    const bound = plausiblePoseDistance({ secondsSinceAccepted: seconds, topSpeed: TOP_SPEED });
    expect(trustedPose(check({ x: SERVER.x + bound }, seconds))).not.toBeNull();
  });

  it.each([0, 0.1, 4])('rejects a pose just over the bound after %s s', (seconds) => {
    const bound = plausiblePoseDistance({ secondsSinceAccepted: seconds, topSpeed: TOP_SPEED });
    expect(trustedPose(check({ x: SERVER.x + bound + 1e-6 }, seconds))).toBeNull();
  });

  it('measures the distance in 3D, not along one axis', () => {
    const bound = plausiblePoseDistance({ secondsSinceAccepted: 0, topSpeed: TOP_SPEED });
    const side = (bound / Math.sqrt(3)) * 1.01;
    expect(trustedPose(check({ x: SERVER.x + side, y: SERVER.y + side, z: SERVER.z + side }, 0))).toBeNull();
    expect(trustedPose(check({ x: SERVER.x - side * 0.98, y: SERVER.y - side * 0.98, z: SERVER.z - side * 0.98 }, 0))).not.toBeNull();
  });

  it('rejects a jump across the map a tenth of a second after the last pose', () => {
    expect(trustedPose(check({ x: SERVER.x + 1000 }, 0.1))).toBeNull();
  });

  it('keeps a plausible pose as it came when its speed is within the cap', () => {
    const pose: PoseMsg = { ...STILL, x: SERVER.x + 1, qy: 0.6, qw: 0.8, vx: TOP_SPEED, vz: 0 };
    expect(trustedPose({ pose, serverPosition: SERVER, secondsSinceAccepted: 0.1, topSpeed: TOP_SPEED })).toStrictEqual(pose);
  });
});

describe('trustedPose — the velocity cap', () => {
  const speedCap = TOP_SPEED * POSE_SPEED_ALLOWANCE;

  it('leaves a velocity exactly at the cap unchanged', () => {
    const pose = trustedPose(check({ vx: speedCap }, 0));
    expect(pose?.vx).toBe(speedCap);
  });

  it('scales a velocity just over the cap down to the cap', () => {
    const pose = trustedPose(check({ vx: speedCap * 1.001 }, 0));
    expect(pose?.vx).toBeCloseTo(speedCap, 9);
  });

  it('scales a velocity over the cap down to the cap and keeps its direction', () => {
    const pose = trustedPose(check({ vx: 300, vy: -100, vz: 200 }, 0));
    if (pose === null) throw new Error('the pose was rejected');
    expect(Math.hypot(pose.vx, pose.vy, pose.vz)).toBeCloseTo(speedCap, 9);
    expect(pose.vx / pose.vz).toBeCloseTo(300 / 200, 9);
    expect(pose.vy / pose.vz).toBeCloseTo(-100 / 200, 9);
    expect(pose.vx).toBeGreaterThan(0);
    expect(pose.vy).toBeLessThan(0);
  });

  it('leaves the position and rotation alone when it caps the velocity', () => {
    const pose = trustedPose(check({ x: SERVER.x + 1, qy: 0.6, qw: 0.8, vx: 500 }, 0));
    expect(pose).toMatchObject({ x: SERVER.x + 1, y: SERVER.y, z: SERVER.z, qx: 0, qy: 0.6, qz: 0, qw: 0.8 });
  });

  it('never caps a car that drives at its own top speed', () => {
    const pose = trustedPose(check({ vz: -TOP_SPEED }, 0));
    expect(pose?.vz).toBe(-TOP_SPEED);
  });
});
