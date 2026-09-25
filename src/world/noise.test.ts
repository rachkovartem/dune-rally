// src/world/noise.test.ts
// Height invariants of Klipfontein (plan v3 S1-1). Retired with the old basin map: the mesa, town
// plaza, lake carve and cliff-wall rows. The border rows live next to the border layer.
import { describe, it, expect } from 'vitest';
import { createHeightField, klipfonteinHeight } from './noise';
import { isOpenPlain } from './testing/openPlain';
import { BUILT_PADS, padWeight } from './terrain/pads';
import { GROOT_KOPPIE, MAP_SIZE, SPAWN_RISE, TAFELKOP } from './mapLayout';
import { SPAWN_SLOT_COUNT, spawnPoseFor } from './worldDef';
import { mulberry32 } from './rng';

const height = createHeightField(1);

/** Largest ground slope (rise over run) at a point, by central differences 1 m apart. */
function slopeAt(x: number, z: number): number {
  return Math.hypot(height(x + 1, z) - height(x - 1, z), height(x, z + 1) - height(x, z - 1)) / 2;
}

describe('createHeightField — one shared world', () => {
  it('gives the same heights for any seed and any instance', () => {
    const other = createHeightField(99999);
    for (const [x, z] of [[0, 0], [1536, 1536], [1480, 600], [2450, 520], [20, 1700], [3070, 3000]]) {
      expect(other(x, z)).toBe(height(x, z));
    }
  });

  it('gives the same height at a point whatever was asked before it (no state kept between calls)', () => {
    // The range keeps a cache per side; the answer must never depend on what is in it.
    const points = [[40, 700], [3000, 1500], [1500, 3050], [700, 25], [40, 710]];
    const forward = points.map(([x, z]) => klipfonteinHeight(x, z));
    const random = mulberry32(7);
    for (let call = 0; call < 5000; call++) klipfonteinHeight(random() * MAP_SIZE, random() * 300);
    const backward = [...points].reverse().map(([x, z]) => klipfonteinHeight(x, z)).reverse();
    expect(backward).toEqual(forward);
  });

  it('gives a finite height outside the map too, where the far layer and the edge chunks sample it', () => {
    for (const [x, z] of [[-500, -500], [-64, 1536], [MAP_SIZE + 400, MAP_SIZE + 10], [1536, -300]]) {
      expect(Number.isFinite(height(x, z))).toBe(true);
    }
  });
});

describe('the spawn rise — no pit at the start (AC2)', () => {
  it('has no ground within 100 m of the spawn higher than the spawn top', () => {
    const top = height(SPAWN_RISE.x, SPAWN_RISE.z);
    let highest = -Infinity;
    for (let offsetX = -100; offsetX <= 100; offsetX += 2) {
      for (let offsetZ = -100; offsetZ <= 100; offsetZ += 2) {
        if (Math.hypot(offsetX, offsetZ) > 100) continue;
        highest = Math.max(highest, height(SPAWN_RISE.x + offsetX, SPAWN_RISE.z + offsetZ));
      }
    }
    expect(highest - top).toBeLessThanOrEqual(0.01);
  });

  it('stands every spawn slot on nearly level ground (slope at most 0.1)', () => {
    for (let slot = 0; slot < SPAWN_SLOT_COUNT; slot++) {
      const pose = spawnPoseFor(slot);
      expect(slopeAt(pose.x, pose.z), `slot ${slot}`).toBeLessThanOrEqual(0.1);
    }
  });
});

describe('the open plain — a car stays planted at real gravity (S1-1)', () => {
  it('bends no more sharply than a 170 m radius anywhere on the open plain', () => {
    const step = 4;
    const random = mulberry32(0x91a1);
    let checked = 0;
    let sharpest = 0;
    while (checked < 2000) {
      const x = random() * MAP_SIZE;
      const z = random() * MAP_SIZE;
      const around = [[x, z], [x + step, z], [x - step, z], [x, z + step], [x, z - step], [x + step, z + step], [x - step, z - step]];
      if (!around.every(([pointX, pointZ]) => isOpenPlain(pointX, pointZ))) continue;
      checked++;
      const centre = height(x, z);
      const alongX = Math.abs(height(x + step, z) - 2 * centre + height(x - step, z)) / step ** 2;
      const alongZ = Math.abs(height(x, z + step) - 2 * centre + height(x, z - step)) / step ** 2;
      const diagonal = Math.abs(height(x + step, z + step) - 2 * centre + height(x - step, z - step)) / (2 * step ** 2);
      sharpest = Math.max(sharpest, alongX, alongZ, diagonal);
    }
    expect(sharpest).toBeLessThanOrEqual(1 / 170);
  });
});

describe('the landforms (design §3)', () => {
  it('raises Groot Koppie 70 ± 3 m above the plain around its foot', () => {
    const footRadius = GROOT_KOPPIE.radius + 30;
    const around = [0, 1, 2, 3].map((quarter) => {
      const angle = (quarter * Math.PI) / 2;
      return height(GROOT_KOPPIE.x + Math.cos(angle) * footRadius, GROOT_KOPPIE.z + Math.sin(angle) * footRadius);
    });
    const foot = around.reduce((sum, value) => sum + value, 0) / around.length;
    const rise = height(GROOT_KOPPIE.x, GROOT_KOPPIE.z) - foot;
    expect(rise).toBeGreaterThanOrEqual(67);
    expect(rise).toBeLessThanOrEqual(73);
  });

  it('keeps the Tafelkop top flat: slope at most 0.05 inside its rim', () => {
    const inside = TAFELKOP.topRadius - TAFELKOP.edgeWander;
    // The overlook pad (a later step) stands on the top with its own blend; it is not the hill.
    const nearPad = (x: number, z: number): boolean => BUILT_PADS.some((pad) => padWeight(pad, x, z) > 0 || padWeight(pad, x + 1, z + 1) > 0 || padWeight(pad, x - 1, z - 1) > 0);
    for (let offsetX = -inside; offsetX <= inside; offsetX += 5) {
      for (let offsetZ = -inside; offsetZ <= inside; offsetZ += 5) {
        if (Math.hypot(offsetX, offsetZ) > inside || nearPad(TAFELKOP.x + offsetX, TAFELKOP.z + offsetZ)) continue;
        expect(slopeAt(TAFELKOP.x + offsetX, TAFELKOP.z + offsetZ)).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('lifts the Tafelkop top well above the plain, so it reads as a hill from far away', () => {
    const plainBeside = height(TAFELKOP.x - TAFELKOP.topRadius - TAFELKOP.skirt - 60, TAFELKOP.z);
    expect(height(TAFELKOP.x, TAFELKOP.z) - plainBeside).toBeGreaterThan(TAFELKOP.height - 5);
  });
});
