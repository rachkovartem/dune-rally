// src/world/seed.test.ts
import { describe, it, expect } from 'vitest';
import { dailySeed, parseSeedFromUrl, resolveSeed } from './seed';
import { hashStringToSeed } from './rng';

describe('dailySeed', () => {
  it('is stable for the same date', () => {
    expect(dailySeed('2026-06-19')).toBe(dailySeed('2026-06-19'));
  });
  it('differs across dates', () => {
    expect(dailySeed('2026-06-19')).not.toBe(dailySeed('2026-06-20'));
  });
});

describe('parseSeedFromUrl', () => {
  it('returns null when no seed param', () => {
    expect(parseSeedFromUrl('https://x.y/')).toBeNull();
  });
  it('parses a numeric seed as an unsigned int', () => {
    expect(parseSeedFromUrl('https://x.y/?seed=42')).toBe(42);
  });
  it('hashes a non-numeric seed string', () => {
    expect(parseSeedFromUrl('https://x.y/?seed=canyon')).toBe(hashStringToSeed('canyon'));
  });
});

describe('resolveSeed', () => {
  it('prefers the URL seed', () => {
    expect(resolveSeed('https://x.y/?seed=99', '2026-06-19')).toBe(99);
  });
  it('falls back to the daily seed', () => {
    expect(resolveSeed('https://x.y/', '2026-06-19')).toBe(dailySeed('2026-06-19'));
  });
});
