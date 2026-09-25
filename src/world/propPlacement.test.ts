// src/world/propPlacement.test.ts
import { describe, it, expect } from 'vitest';
import { isPropAllowedAt } from './propPlacement';
import { LAKE } from './worldDef';

describe('isPropAllowedAt — nothing stands in the lake or on its shore (R15)', () => {
  const footprint = LAKE.radius + LAKE.feather;
  const eastOfLake = (distance: number): [number, number] => [LAKE.x + distance, LAKE.z];

  it('refuses the lake centre, its whole footprint and the margin round it', () => {
    expect(isPropAllowedAt(LAKE.x, LAKE.z)).toBe(false);
    expect(isPropAllowedAt(...eastOfLake(footprint))).toBe(false);
    expect(isPropAllowedAt(...eastOfLake(footprint + 1.99))).toBe(false);
  });

  it('allows ground just past the margin', () => {
    expect(isPropAllowedAt(...eastOfLake(footprint + 2))).toBe(true);
    expect(isPropAllowedAt(LAKE.x, LAKE.z - footprint - 10)).toBe(true);
  });
});
