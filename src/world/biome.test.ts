// src/world/biome.test.ts
// Cover v1 of Klipfontein (plan v3 S1-1). Retired with the old map: the road, town and lake-shore
// rows (no road, town or lake exists until steps S2 and S4).
import { describe, it, expect } from 'vitest';
import { COVER_IDS, coverFromIndex, coverIndex, createBiome, type Cover } from './biome';
import { borderAt } from './terrain/border';
import { isOpenPlain } from './testing/openPlain';
import { DOLERITE_RIDGE, GROOT_KOPPIE, SPAWN_RISE } from './mapLayout';
import { mulberry32 } from './rng';

const biome = createBiome(1);
const FLAT = 0;

/** The first point straight in from the north edge at `x` that lies on the gravel apron. */
function apronPoint(x: number): { x: number; z: number } {
  for (let z = 151; z < 300; z++) if (borderAt(x, z).inApron) return { x, z };
  throw new Error(`no apron at x ${x}`);
}


describe('coverIndex / coverFromIndex — a cover as a small number for the worker buffer (R3a)', () => {
  it('round-trips every cover', () => {
    for (const cover of COVER_IDS) expect(coverFromIndex(coverIndex(cover))).toBe(cover);
  });

  it('gives every cover its own index that fits a byte', () => {
    const indices = COVER_IDS.map(coverIndex);
    expect(new Set(indices).size).toBe(COVER_IDS.length);
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(256);
    }
  });

  it.each([-1, COVER_IDS.length, 1.5, Number.NaN])('throws for index %s instead of guessing a cover', (index) => {
    expect(() => coverFromIndex(index)).toThrow('no cover has index');
  });
});

describe('createBiome(seed).coverAt — cover v1 (S1-1)', () => {
  it('paints the border face rock even where the given slope is flat', () => {
    expect(biome.coverAt(1500, 60, 50, FLAT)).toBe('rock');
    expect(biome.coverAt(3072 - 60, 1500, 50, FLAT)).toBe('rock');
  });

  it('paints the apron before the face gravel, and rock where it is steep', () => {
    const apron = apronPoint(1500);
    expect(biome.coverAt(apron.x, apron.z, 10, FLAT)).toBe('gravel');
    expect(biome.coverAt(apron.x, apron.z, 10, 0.6)).toBe('rock');
  });

  it('paints the spawn top gravel', () => {
    expect(biome.coverAt(SPAWN_RISE.x, SPAWN_RISE.z, 12, FLAT)).toBe('gravel');
    expect(biome.coverAt(SPAWN_RISE.x + SPAWN_RISE.top, SPAWN_RISE.z, 12, FLAT)).toBe('gravel');
  });

  it('paints the dolerite ridge rock', () => {
    const middle = DOLERITE_RIDGE.line[1];
    expect(biome.coverAt(middle.x, middle.z, 40, FLAT)).toBe('rock');
  });

  it('paints the upper koppie gravel where it is gentle and rock where it is steep', () => {
    const upper = { x: GROOT_KOPPIE.x + GROOT_KOPPIE.radius * 0.3, z: GROOT_KOPPIE.z };
    expect(biome.coverAt(upper.x, upper.z, 60, 0.1)).toBe('gravel');
    expect(biome.coverAt(upper.x, upper.z, 60, 0.4)).toBe('rock');
  });

  it('paints a plain slope steeper than 0.55 rock and one between 0.3 and 0.55 gravel', () => {
    const plain = { x: 1000, z: 1500 };
    expect(isOpenPlain(plain.x, plain.z)).toBe(true);
    expect(biome.coverAt(plain.x, plain.z, 10, 0.56)).toBe('rock');
    expect(biome.coverAt(plain.x, plain.z, 10, 0.4)).toBe('gravel');
  });

  it('covers the flat open plain with patches of sand, dry grass and dirt, and nothing else', () => {
    const random = mulberry32(0xc0e);
    const seen = new Set<Cover>();
    let checked = 0;
    while (checked < 2000) {
      const x = random() * 3072;
      const z = random() * 3072;
      if (!isOpenPlain(x, z)) continue;
      checked++;
      seen.add(biome.coverAt(x, z, 10, FLAT));
    }
    expect([...seen].sort()).toEqual(['dirt', 'dryGrass', 'sand']);
  });

  it('gives the same cover for the same seed and point', () => {
    const again = createBiome(1);
    for (const [x, z] of [[1000, 1500], [2000, 800], [700, 2500]]) expect(again.coverAt(x, z, 10, FLAT)).toBe(biome.coverAt(x, z, 10, FLAT));
  });
});
