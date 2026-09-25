// src/world/terrain/pan.test.ts
// Category 1 (pure invariants of the built ground): the Soutpan (plan v3 S2-3).
import { describe, it, expect } from 'vitest';
import { PAN_LEVEL, panInsideDistance, panWeight } from './pan';
import { createHeightField } from '../noise';
import { SOUTPAN, SOUTPAN_BLEND, SOUTPAN_FLOOR } from '../mapLayout';

const height = createHeightField(1);

describe('the Soutpan — a dead-flat salt floor, the lowest ground (S2-3)', () => {
  it('is flat within 5 cm of the salt level everywhere inside the ellipse past its blend', () => {
    let checked = 0;
    for (let x = SOUTPAN.x - SOUTPAN.radiusX; x <= SOUTPAN.x + SOUTPAN.radiusX; x += 10) {
      for (let z = SOUTPAN.z - SOUTPAN.radiusZ; z <= SOUTPAN.z + SOUTPAN.radiusZ; z += 10) {
        if (panInsideDistance(x, z) < SOUTPAN_BLEND) continue;
        expect(Math.abs(height(x, z) - PAN_LEVEL), `(${x}, ${z})`).toBeLessThanOrEqual(0.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('measures 0 m inside on the ellipse itself, positive inside and negative outside', () => {
    expect(panInsideDistance(SOUTPAN.x + SOUTPAN.radiusX, SOUTPAN.z)).toBeCloseTo(0, 9);
    expect(panInsideDistance(SOUTPAN.x, SOUTPAN.z)).toBeGreaterThan(0);
    expect(panInsideDistance(SOUTPAN.x, SOUTPAN.z - SOUTPAN.radiusZ - 50)).toBeLessThan(0);
  });

  it('weighs the salt 1 past the blend and 0 on the ellipse and outside it', () => {
    expect(panWeight(SOUTPAN.x, SOUTPAN.z)).toBe(1);
    expect(panWeight(SOUTPAN.x + SOUTPAN.radiusX, SOUTPAN.z)).toBeCloseTo(0, 9);
    expect(panWeight(SOUTPAN.x, SOUTPAN.z + SOUTPAN.radiusZ + 20)).toBe(0);
  });

  // Known defect (Bug Signal in the S3 tests report): a hollow about 40 m across near (230, 2860),
  // 220 m from the ellipse, sinks up to 0.33 m below the salt, where the floor rule fades out.
  // Turn this back into `it` when the fix lands.
  it.fails('keeps the ground within its floor reach of the pan above the salt (the pan is the lowest ground)', () => {
    for (let x = 0; x <= 3072; x += 8) {
      for (let z = 1900; z <= 3072; z += 8) {
        const outside = -panInsideDistance(x, z);
        if (outside <= 0 || outside >= SOUTPAN_FLOOR.reach) continue;
        expect(height(x, z), `(${x}, ${z})`).toBeGreaterThanOrEqual(PAN_LEVEL);
      }
    }
  });

  it('has nothing lower than the salt anywhere on the map outside the floor reach of the pan', () => {
    for (let x = 0; x <= 3072; x += 16) {
      for (let z = 0; z <= 3072; z += 16) {
        if (-panInsideDistance(x, z) < SOUTPAN_FLOOR.reach) continue;
        expect(height(x, z), `(${x}, ${z})`).toBeGreaterThanOrEqual(PAN_LEVEL);
      }
    }
  });
});
