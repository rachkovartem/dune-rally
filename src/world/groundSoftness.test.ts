// src/world/groundSoftness.test.ts
// Category 1 (pure): how soft the ground is at a place (SH-3). The cover decides first, then the place.
import { describe, it, expect } from 'vitest';
import { groundSoftnessAt } from './groundSoftness';
import { COVER_IDS, createBiome } from './biome';
import { createHeightField } from './noise';
import { surfaceSampleAt } from './surfaceSample';

const height = createHeightField(1);
const biome = createBiome(1);
const coverAt = (x: number, z: number) => {
  const surface = surfaceSampleAt(height, x, z);
  return biome.coverAt(x, z, surface.height, surface.slope);
};
const softnessHere = (x: number, z: number): number => groundSoftnessAt(x, z, coverAt(x, z));

const DUNE_FIELD = { x: 2400, z: 1500 };
const RIVER_BED = { x: 765, z: 1350 };
const OPEN_PLAIN = { x: 1300, z: 1600 };

describe('groundSoftnessAt — soft dunes, softer river sand, a firm plain (SH-3)', () => {
  it.each<[string, { x: number; z: number }, number]>([
    ['the dune field', DUNE_FIELD, 1],
    ['the river bed sand', RIVER_BED, 0.6],
    ['the open plain sand', OPEN_PLAIN, 0.15],
  ])('gives %s its softness', (_name, point, expected) => {
    expect(coverAt(point.x, point.z)).toBe('sand');
    expect(softnessHere(point.x, point.z)).toBe(expected);
  });

  it('regression: the sand at the salt pan edge (1050, 2320) is the firm plain, so an Elantra launch there is slow but not stuck', () => {
    expect(coverAt(1050, 2320)).toBe('sand');
    expect(softnessHere(1050, 2320)).toBe(0.15);
  });

  it('makes the river\'s sand fan on the pan as soft as the river bed', () => {
    expect(coverAt(640, 2440)).toBe('sand');
    expect(softnessHere(640, 2440)).toBe(0.6);
  });

  it.each(['gravel', 'road', 'rock', 'salt', 'dirt', 'dryGrass'] as const)('gives %s no softness anywhere, even inside the dune field', (cover) => {
    expect(groundSoftnessAt(DUNE_FIELD.x, DUNE_FIELD.z, cover)).toBe(0);
    expect(groundSoftnessAt(RIVER_BED.x, RIVER_BED.z, cover)).toBe(0);
  });

  it('gives mud a softness between the river sand and the dunes', () => {
    const mud = groundSoftnessAt(OPEN_PLAIN.x, OPEN_PLAIN.z, 'mud');
    expect(mud).toBeGreaterThan(softnessHere(RIVER_BED.x, RIVER_BED.z));
    expect(mud).toBeLessThan(softnessHere(DUNE_FIELD.x, DUNE_FIELD.z));
  });

  it('keeps every softness in 0..1, for every cover at every sampled place', () => {
    for (const point of [DUNE_FIELD, RIVER_BED, OPEN_PLAIN, { x: 1050, z: 2560 }]) {
      for (const cover of COVER_IDS) {
        const softness = groundSoftnessAt(point.x, point.z, cover);
        expect(softness).toBeGreaterThanOrEqual(0);
        expect(softness).toBeLessThanOrEqual(1);
      }
    }
  });

  it('steps once from the plain straight to dune sand at the west edge of the dune field, with nothing in between', () => {
    // Along z = 1500 from the plain into the field: a flicker or a middle value here would change
    // how a car digs at the edge from one metre to the next.
    const values: number[] = [];
    for (let x = 2140; x <= 2260; x += 0.5) values.push(softnessHere(x, 1500));
    expect(values[0]).toBe(0.15);
    expect(values[values.length - 1]).toBe(1);
    const changes = values.filter((value, index) => index > 0 && value !== values[index - 1]);
    expect(changes).toEqual([1]);
  });
});
