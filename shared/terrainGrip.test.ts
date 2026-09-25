// shared/terrainGrip.test.ts
import { describe, it, expect } from 'vitest';
import { groundGripFor, rollingResistanceFor, ROAD_ROLLING_RESISTANCE, type GripOverrides } from './terrainGrip';
import { COVER_IDS, type Cover } from '../src/world/biome';
import { CAR_IDS, isCarId } from '../src/vehicle/cars';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';

const ALL_COVERS = COVER_IDS;
const NO_OVERRIDES = { gripOverrides: {} };
// Replacement (S2-3): terrainGripFor became groundGripFor, which also carries the rolling resistance.
const terrainGripFor = (cover: Cover, config: GripOverrides): number => groundGripFor(cover, config).grip;

describe('groundGripFor(...).grip — the grip layer every car drives on (R114–R119)', () => {
  it.each(CAR_IDS)('gives the %s its best grip on the road', (carId) => {
    const config = vehicleConfigFor(carId);
    const road = terrainGripFor('road', config);
    for (const cover of ALL_COVERS) expect(terrainGripFor(cover, config)).toBeLessThanOrEqual(road);
  });

  it.each(CAR_IDS)('keeps every grip of the %s in (0, 1]', (carId) => {
    const config = vehicleConfigFor(carId);
    for (const cover of ALL_COVERS) {
      const grip = terrainGripFor(cover, config);
      expect(grip).toBeGreaterThan(0);
      expect(grip).toBeLessThanOrEqual(1);
    }
  });

  it('uses a car\'s own override for a cover instead of the base grip', () => {
    expect(terrainGripFor('sand', { gripOverrides: { sand: 0.33 } })).toBe(0.33);
    expect(terrainGripFor('sand', { gripOverrides: { mud: 0.2 } })).toBe(terrainGripFor('sand', NO_OVERRIDES));
  });

  it('holds the Pajero better than the Forester on sand (bigger tyres, more clearance)', () => {
    expect(terrainGripFor('sand', vehicleConfigFor('pajero'))).toBeGreaterThan(terrainGripFor('sand', vehicleConfigFor('forester')));
  });

  it('holds the Forester at least as well as the Pajero on the road', () => {
    expect(terrainGripFor('road', vehicleConfigFor('forester'))).toBeGreaterThanOrEqual(terrainGripFor('road', vehicleConfigFor('pajero')));
  });

  it.each([...CAR_IDS, 'no overrides'])('orders road ≥ gravel ≥ dirt ≥ sand ≥ mud for %s', (carId) => {
    const config = isCarId(carId) ? vehicleConfigFor(carId) : NO_OVERRIDES;
    const ordered: Cover[] = ['road', 'gravel', 'dirt', 'sand', 'mud'];
    const grips = ordered.map((cover) => terrainGripFor(cover, config));
    for (let index = 1; index < grips.length; index++) expect(grips[index]).toBeLessThanOrEqual(grips[index - 1]);
  });
});

describe('rollingResistanceFor', () => {
  it('is the road value at full grip, and grip above 1 does not lower it further', () => {
    expect(rollingResistanceFor(1)).toBe(ROAD_ROLLING_RESISTANCE);
    expect(rollingResistanceFor(1.4)).toBe(ROAD_ROLLING_RESISTANCE);
  });

  it('grows as the ground gets softer', () => {
    const values = [1, 0.9, 0.75, 0.6, 0.45].map(rollingResistanceFor);
    for (let index = 1; index < values.length; index++) expect(values[index]).toBeGreaterThan(values[index - 1]);
  });

  it('makes soft sand roll several times harder than the road, as measured on real tyres', () => {
    // Real tyres: about 0.015 on asphalt and 0.04–0.1 on loose sand.
    const sand = rollingResistanceFor(terrainGripFor('sand', NO_OVERRIDES));
    expect(sand).toBeGreaterThanOrEqual(0.04);
    expect(sand).toBeLessThanOrEqual(0.1);
  });
});
