// shared/terrainGrip.test.ts
import { describe, it, expect } from 'vitest';
import {
  FIRM_SAND, FULL_GRIP, groundFor, groundGripFor, rollingResistanceFor, ROAD_ROLLING_RESISTANCE, type GripOverrides,
} from './terrainGrip';
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

describe('groundGripFor — the hard salt crust (S2-3)', () => {
  it.each(CAR_IDS)('rolls the %s on salt like on the road, easier than on gravel', (carId) => {
    const config = vehicleConfigFor(carId);
    expect(groundGripFor('salt', config).rollingResistance).toBe(ROAD_ROLLING_RESISTANCE);
    expect(groundGripFor('salt', config).rollingResistance).toBeLessThan(groundGripFor('gravel', config).rollingResistance);
  });
});

describe('groundFor(cover, softness, config) — the ground at a place (SH-1, SH-3)', () => {
  it('is the flat bench ground on a road with no sinkage', () => {
    expect(groundFor('road', 0, NO_OVERRIDES)).toEqual(FULL_GRIP);
  });

  it.each(ALL_COVERS.filter((cover) => cover !== 'sand'))('agrees with groundGripFor on %s at softness 0', (cover) => {
    for (const config of [NO_OVERRIDES, ...CAR_IDS.map(vehicleConfigFor)]) expect(groundFor(cover, 0, config)).toEqual(groundGripFor(cover, config));
  });

  it('carries the softness of the place unchanged', () => {
    expect(groundFor('sand', 0.6, NO_OVERRIDES).softness).toBe(0.6);
    expect(groundFor('gravel', 0, NO_OVERRIDES).softness).toBe(0);
  });

  it('keeps the road firm and fully grippy sideways, and makes sand the loosest cover', () => {
    const road = groundFor('road', 0, NO_OVERRIDES);
    expect(road.looseness).toBe(0);
    expect(road.lateralFactor).toBe(1);
    const sand = groundFor('sand', 1, NO_OVERRIDES).looseness;
    for (const cover of ALL_COVERS) expect(groundFor(cover, 0, NO_OVERRIDES).looseness).toBeLessThanOrEqual(sand);
  });

  it('keeps the salt crust firm (it must not slide like gravel) and lets gravel roll away sideways', () => {
    expect(groundFor('salt', 0, NO_OVERRIDES).looseness).toBeLessThan(groundFor('gravel', 0, NO_OVERRIDES).looseness);
    expect(groundFor('gravel', 0, NO_OVERRIDES).lateralFactor).toBeLessThan(1);
  });

  it.each(CAR_IDS)('grips the %s better on the firm plain sand than on soft dune sand (owner decision)', (carId) => {
    const config = vehicleConfigFor(carId);
    const plain = groundFor('sand', FIRM_SAND.maxSoftness, config).grip;
    const justSofter = groundFor('sand', FIRM_SAND.maxSoftness + 0.01, config).grip;
    const dune = groundFor('sand', 1, config).grip;
    expect(plain).toBeGreaterThan(dune);
    expect(justSofter).toBe(dune);
    expect(plain).toBeLessThanOrEqual(1);
  });

  it('never lifts the firm sand grip above 1, even for a car with a high sand override', () => {
    expect(groundFor('sand', 0, { gripOverrides: { sand: 0.95 } }).grip).toBe(1);
  });

  it('rolls harder on the firm plain than on the road even though it grips better than dune sand', () => {
    expect(groundFor('sand', 0.15, NO_OVERRIDES).rollingResistance).toBeGreaterThan(ROAD_ROLLING_RESISTANCE);
  });

  it.each([-0.01, 1.01, Number.NaN])('throws for a softness of %s instead of clamping it quietly', (softness) => {
    expect(() => groundFor('sand', softness, NO_OVERRIDES)).toThrow('outside 0..1');
  });
});
