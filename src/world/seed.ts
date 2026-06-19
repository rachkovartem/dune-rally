// src/world/seed.ts
import { hashStringToSeed } from './rng';

export function dailySeed(dateISO: string): number {
  return hashStringToSeed(`dune-rally:${dateISO}`);
}

export function parseSeedFromUrl(url: string): number | null {
  const value = new URL(url).searchParams.get('seed');
  if (value === null || value === '') return null;
  if (/^\d+$/.test(value)) return Number(value) >>> 0;
  return hashStringToSeed(value);
}

export function resolveSeed(url: string, todayISO: string): number {
  return parseSeedFromUrl(url) ?? dailySeed(todayISO);
}
