// src/world/terrain/pads.test.ts
// Category 1 (pure invariants of the built ground): the level pads (plan v3 S2-1).
import { describe, it, expect } from 'vitest';
import { BUILT_PADS, distanceOutsidePad, padAt, type Pad } from './pads';
import { createHeightField } from '../noise';

const height = createHeightField(1);

function edgePoints(pad: Pad): { x: number; z: number }[] {
  const shape = pad.def.shape;
  if (shape.kind === 'circle') {
    return Array.from({ length: 72 }, (_unused, index) => {
      const angle = (index / 72) * Math.PI * 2;
      return { x: shape.x + shape.radius * Math.cos(angle), z: shape.z + shape.radius * Math.sin(angle) };
    });
  }
  const points: { x: number; z: number }[] = [];
  for (let share = 0; share <= 1; share += 0.05) {
    const x = shape.x - shape.width / 2 + share * shape.width;
    const z = shape.z - shape.depth / 2 + share * shape.depth;
    points.push({ x, z: shape.z - shape.depth / 2 }, { x, z: shape.z + shape.depth / 2 }, { x: shape.x - shape.width / 2, z }, { x: shape.x + shape.width / 2, z });
  }
  return points;
}

describe('the pads — level flats that are never a pit (S2-1)', () => {
  it.each(BUILT_PADS.map((pad) => [pad.def.name, pad] as const))('keeps the ground at the edge of the %s at most 0.5 m above the pad', (_name, pad) => {
    for (const point of edgePoints(pad)) expect(height(point.x, point.z) - pad.level).toBeLessThanOrEqual(0.5);
  });

  it.each(BUILT_PADS.map((pad) => [pad.def.name, pad] as const))('makes the %s level: every point on it within 5 cm of its level', (_name, pad) => {
    const shape = pad.def.shape;
    for (let index = 0; index < 40; index++) {
      const angle = index * 2.4;
      const reach = (index / 40) * 0.9;
      const x = shape.kind === 'circle' ? shape.x + reach * shape.radius * Math.cos(angle) : shape.x + reach * (shape.width / 2) * Math.cos(angle);
      const z = shape.kind === 'circle' ? shape.z + reach * shape.radius * Math.sin(angle) : shape.z + reach * (shape.depth / 2) * Math.sin(angle);
      expect(distanceOutsidePad(shape, x, z)).toBe(0);
      expect(padAt(x, z)).toBe(pad);
      expect(Math.abs(height(x, z) - pad.level)).toBeLessThanOrEqual(0.05);
    }
  });

  it('answers no pad just outside a pad\'s own shape', () => {
    for (const pad of BUILT_PADS) {
      const shape = pad.def.shape;
      const outside = shape.kind === 'circle' ? { x: shape.x + shape.radius + 0.5, z: shape.z } : { x: shape.x + shape.width / 2 + 0.5, z: shape.z };
      expect(padAt(outside.x, outside.z)).toBeNull();
    }
  });
});
