// src/world/noise.test.ts
import { describe, it, expect } from 'vitest';
import { createHeightField } from './noise';
import { MESA, BORDER_HEIGHT, WORLD_SIZE } from './worldDef';

describe('createHeightField (authored world)', () => {
  it('is deterministic', () => {
    const a = createHeightField(123);
    const b = createHeightField(123);
    for (const [x, z] of [[0, 0], [256, 256], [400, 150]]) {
      expect(a(x, z)).toBeCloseTo(b(x, z), 10);
    }
  });

  it('is the SAME unique world regardless of seed', () => {
    const a = createHeightField(1);
    const b = createHeightField(99999);
    for (const [x, z] of [[100, 100], [256, 96], [430, 360]]) {
      expect(a(x, z)).toBeCloseTo(b(x, z), 10);
    }
  });

  it('raises a mesa plateau and a flat town plaza', () => {
    const h = createHeightField(1);
    expect(h(MESA.x, MESA.z)).toBeGreaterThan(MESA.top - 2); // mesa top is high
    expect(Math.abs(h(256, 256))).toBeLessThan(1.5);          // town plaza ~ flat at 0
  });

  it('walls the world with un-climbable cliffs at the border', () => {
    const h = createHeightField(1);
    expect(h(4, 256)).toBeGreaterThan(BORDER_HEIGHT - 5);            // near the edge
    expect(h(WORLD_SIZE - 4, 256)).toBeGreaterThan(BORDER_HEIGHT - 5);
  });

  it('stays within sane bounds across the playable area', () => {
    const h = createHeightField(1);
    for (let i = 0; i < 600; i++) {
      const x = (i * 17.3) % WORLD_SIZE;
      const z = (i * 29.7) % WORLD_SIZE;
      const v = h(x, z);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(BORDER_HEIGHT + 2);
    }
  });
});
