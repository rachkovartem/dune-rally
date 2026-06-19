// src/world/rng.test.ts
import { describe, it, expect } from 'vitest';
import { mulberry32, hashStringToSeed } from './rng';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces different streams for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('hashStringToSeed', () => {
  it('is deterministic', () => {
    expect(hashStringToSeed('2026-06-19')).toBe(hashStringToSeed('2026-06-19'));
  });

  it('differs for different strings', () => {
    expect(hashStringToSeed('a')).not.toBe(hashStringToSeed('b'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hashStringToSeed('dune');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
