// src/world/worldDef.test.ts
// Retired with the old basin map (plan v3 S1-1): the placed-feature, mesa, cliff, lake and town rows.
import { describe, it, expect } from 'vitest';
import {
  NORTH_YAW, SPAWN, SPAWN_SLOT_COUNT, WORLD_SIZE, isPropExcluded, rotationForYaw, spawnPoseFor,
} from './worldDef';
import { forwardAxisOf, upAxisOf } from '../../shared/vehiclePhysics';

const allSlots = (): number[] => Array.from({ length: SPAWN_SLOT_COUNT }, (_unused, slot) => slot);

describe('spawnPoseFor — where each car starts (S1-2)', () => {
  it('faces every slot north (−z)', () => {
    for (const slot of allSlots()) {
      const forward = forwardAxisOf(rotationForYaw(spawnPoseFor(slot).yaw));
      expect(forward.z, `slot ${slot}`).toBeCloseTo(-1, 9);
    }
  });

  it('keeps every two slots at least 5 m apart, so two cars never start inside each other', () => {
    const poses = allSlots().map(spawnPoseFor);
    for (let first = 0; first < poses.length; first++) {
      for (let second = first + 1; second < poses.length; second++) {
        expect(Math.hypot(poses[first].x - poses[second].x, poses[first].z - poses[second].z)).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('puts every slot near the spawn rise, inside the map', () => {
    for (const slot of allSlots()) {
      const pose = spawnPoseFor(slot);
      expect(Math.hypot(pose.x - SPAWN.x, pose.z - SPAWN.z)).toBeLessThan(60);
      expect(pose.x).toBeGreaterThan(0);
      expect(pose.x).toBeLessThan(WORLD_SIZE);
    }
  });

  it('wraps a slot past the last one back to the first, so a full room still gets a place', () => {
    expect(spawnPoseFor(SPAWN_SLOT_COUNT)).toEqual(spawnPoseFor(0));
    expect(spawnPoseFor(SPAWN_SLOT_COUNT + 3)).toEqual(spawnPoseFor(3));
  });

  it.each([-1, 1.5, Number.NaN])('throws for slot %s instead of starting a car at a made-up place', (slot) => {
    expect(() => spawnPoseFor(slot)).toThrow('spawnPoseFor');
  });
});

describe('rotationForYaw — the upright rotation for a heading', () => {
  it.each([0, Math.PI / 2, NORTH_YAW, -Math.PI / 2, 2.3])('turns the nose to (sin yaw, 0, cos yaw) and keeps the roof up for yaw %s', (yaw) => {
    const rotation = rotationForYaw(yaw);
    const forward = forwardAxisOf(rotation);
    expect(forward.x).toBeCloseTo(Math.sin(yaw), 9);
    expect(forward.y).toBeCloseTo(0, 9);
    expect(forward.z).toBeCloseTo(Math.cos(yaw), 9);
    expect(upAxisOf(rotation).y).toBeCloseTo(1, 9);
    expect(Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w)).toBeCloseTo(1, 12);
  });
});

describe('isPropExcluded — where no natural prop may stand (S1-1)', () => {
  it('keeps every spawn slot clear, so no car starts inside a boulder', () => {
    for (const slot of allSlots()) {
      const pose = spawnPoseFor(slot);
      expect(isPropExcluded(pose.x, pose.z), `slot ${slot}`).toBe(true);
    }
  });

  it('keeps the spawn top clear and lets props stand on the plain beyond it', () => {
    expect(isPropExcluded(SPAWN.x, SPAWN.z)).toBe(true);
    expect(isPropExcluded(SPAWN.x + 200, SPAWN.z)).toBe(false);
  });
});
