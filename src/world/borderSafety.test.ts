// src/world/borderSafety.test.ts
import { describe, it, expect } from 'vitest';
import { borderEscapeTarget, ESCAPE_FACE_DEPTH } from './borderSafety';
import { borderDistance, borderFaceDepth, crestFor } from './terrain/border';
import { createHeightField } from './noise';
import { BORDER, MAP_SIZE, NW_GORGE } from './mapLayout';
import type { SpawnPose } from './worldDef';

const height = createHeightField(1);
/**
 * A reset target is safe when it is out in the valley, the net does not fire again there (no reset
 * loop), and the car faces into the valley, away from the range it came from.
 */
function isSafeTarget(pose: SpawnPose | null): boolean {
  if (pose === null) return false;
  const inValley = borderFaceDepth(pose.x, pose.z) < 0;
  const staysPut = borderEscapeTarget(pose.x, height(pose.x, pose.z) + 2, pose.z, height) === null;
  const towardCentre = Math.sin(pose.yaw) * (MAP_SIZE / 2 - pose.x) + Math.cos(pose.yaw) * (MAP_SIZE / 2 - pose.z);
  return inValley && staysPut && towardCentre > 0;
}

describe('borderEscapeTarget — the net behind the ranges (S1-1, design §2)', () => {
  it('leaves a car on the open plain alone', () => {
    expect(borderEscapeTarget(1536, height(1536, 1536) + 1, 1536, height)).toBeNull();
  });

  it('leaves a car alone that got up the face but not 40 m past its foot', () => {
    // 30 m past the foot of the north face, on the ground: it slides back down by itself.
    const z = BORDER.faceFoot - 30;
    expect(borderEscapeTarget(1200, height(1200, z) + 0.5, z, height)).toBeNull();
  });

  it('puts a car that got above the crest far up the range back in the valley, facing into it', () => {
    const z = 20;
    const crest = crestFor(1500, z);
    if (!crest) throw new Error('no crest on the north side');
    const target = borderEscapeTarget(1500, Math.max(height(1500, z), crest.height) + 1, z, height);
    expect(isSafeTarget(target)).toBe(true);
  });

  it('does not reset a car above the crest height until it is more than 40 m past the face foot', () => {
    // Just at the limit and just past it on the north face, both high in the air.
    const atLimit = BORDER.faceFoot - ESCAPE_FACE_DEPTH;
    expect(borderFaceDepth(1500, atLimit)).toBeCloseTo(ESCAPE_FACE_DEPTH, 9);
    expect(borderEscapeTarget(1500, 500, atLimit, height)).toBeNull();
    expect(isSafeTarget(borderEscapeTarget(1500, 500, atLimit - 0.5, height))).toBe(true);
  });

  it('puts a car that left the map back inside it, in the valley', () => {
    for (const [x, z] of [[-3, 1500], [1500, MAP_SIZE + 12], [-40, -40]]) {
      const target = borderEscapeTarget(x, 0, z, height);
      expect(borderDistance(target?.x ?? -1, target?.z ?? -1)).toBeGreaterThan(0);
      expect(isSafeTarget(target)).toBe(true);
    }
  });

  it('never resets a car driving down in the NW gorge, though it is deep past the face foot', () => {
    // A few metres before the dry waterfall, at the dead end of the gorge.
    const x = NW_GORGE.waterfall.x + 0.1 * (NW_GORGE.mouth.x - NW_GORGE.waterfall.x);
    const z = NW_GORGE.waterfall.z + 0.1 * (NW_GORGE.mouth.z - NW_GORGE.waterfall.z);
    expect(borderFaceDepth(x, z)).toBeGreaterThan(ESCAPE_FACE_DEPTH);
    expect(borderEscapeTarget(x, height(x, z) + 1, z, height)).toBeNull();
  });

  it('throws for a position that is not a number instead of guessing a reset', () => {
    expect(() => borderEscapeTarget(Number.NaN, 0, 0, height)).toThrow('not finite');
  });
});
