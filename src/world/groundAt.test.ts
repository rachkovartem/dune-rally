// src/world/groundAt.test.ts
// Category 1 (pure, biome and height field as inputs): the one ground reader of the client and the
// server (R-S2, SH-3). What a car gets at a real place of the map.
import { describe, it, expect } from 'vitest';
import { groundAt } from './groundAt';
import { createBiome } from './biome';
import { createHeightField } from './noise';
import { ROAD_ROLLING_RESISTANCE } from '../../shared/terrainGrip';
import { vehicleConfigFor } from '../vehicle/vehicleConfig';
import { CAR_IDS } from '../vehicle/cars';

const height = createHeightField(1);
const biome = createBiome(1);
const at = (x: number, z: number, carId: (typeof CAR_IDS)[number] = 'forester') => groundAt(biome, height, x, z, vehicleConfigFor(carId));

describe('groundAt — the ground under a car (R-S2, SH-3)', () => {
  it('reads the dune field as soft sand, and the ground it gives carries that softness', () => {
    const dune = at(2400, 1500);
    expect(dune.cover).toBe('sand');
    expect(dune.softness).toBe(1);
    expect(dune.ground.softness).toBe(1);
  });

  it('gives the Pajero more grip than the Elantra on the same dune sand (each car\'s own tyres)', () => {
    expect(at(2400, 1500, 'pajero').ground.grip).toBeGreaterThan(at(2400, 1500, 'elantra').ground.grip);
  });

  it.each(CAR_IDS)('gives the %s more grip on the firm plain sand than on dune sand', (carId) => {
    expect(at(1300, 1600, carId).ground.grip).toBeGreaterThan(at(2400, 1500, carId).ground.grip);
  });

  it('reads the spine road as firm gravel with no softness', () => {
    const road = at(1560, 1500);
    expect(road.cover).toBe('gravel');
    expect(road.softness).toBe(0);
  });

  it('reads Die Myl on the pan as salt that rolls like a road', () => {
    const salt = at(1200, 2560);
    expect(salt.cover).toBe('salt');
    expect(salt.ground.rollingResistance).toBe(ROAD_ROLLING_RESISTANCE);
  });

  it('gives the same answer for the same place every time (client and server read the same ground)', () => {
    expect(groundAt(createBiome(1), createHeightField(1), 765, 1350, vehicleConfigFor('pajero')))
      .toEqual(groundAt(biome, height, 765, 1350, vehicleConfigFor('pajero')));
  });
});
