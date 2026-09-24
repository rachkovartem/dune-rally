// src/assets/loadProgress.ts

export interface ProgressEntry {
  loaded: number;
  total: number;
}

/**
 * Combined 0..1 progress across several loads. An entry whose total isn't known yet (0 or
 * negative) is excluded rather than let through — dividing by it would give NaN/Infinity and
 * corrupt the whole readout instead of just under-reporting that one entry.
 */
export function progressFraction(entries: readonly ProgressEntry[]): number {
  const knownEntries = entries.filter((entry) => entry.total > 0);
  if (knownEntries.length === 0) return 0;

  const loadedTotal = knownEntries.reduce((sum, entry) => sum + entry.loaded, 0);
  const sizeTotal = knownEntries.reduce((sum, entry) => sum + entry.total, 0);
  return loadedTotal / sizeTotal;
}
