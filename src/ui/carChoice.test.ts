// src/ui/carChoice.test.ts
import { describe, it, expect } from 'vitest';
import { CAR_CHOICE_STORAGE_KEY, readSavedCarId, saveCarId } from './carChoice';
import { DEFAULT_CAR_ID } from '../vehicle/cars';

/** An in-memory stand-in for localStorage. */
function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('car choice persistence (R129–R132)', () => {
  it('offers the default car on a first visit, when nothing was saved', () => {
    expect(readSavedCarId(memoryStorage())).toBe(DEFAULT_CAR_ID);
  });

  it('reads back the car picked on an earlier visit', () => {
    const storage = memoryStorage();
    saveCarId(storage, 'pajero');
    expect(readSavedCarId(storage)).toBe('pajero');
  });

  it('keeps only the latest pick', () => {
    const storage = memoryStorage();
    saveCarId(storage, 'pajero');
    saveCarId(storage, 'forester');
    expect(readSavedCarId(storage)).toBe('forester');
  });

  it.each(['lada-niva', 'PAJERO', ''])('falls back to the default car when the saved value is "%s", without throwing', (saved) => {
    // An old build or a hand edit may have left anything under the key.
    expect(readSavedCarId(memoryStorage({ [CAR_CHOICE_STORAGE_KEY]: saved }))).toBe(DEFAULT_CAR_ID);
  });
});
