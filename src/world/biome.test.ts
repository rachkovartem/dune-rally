// src/world/biome.test.ts
import { describe, it, expect } from 'vitest';
import { createBiome } from './biome';
import { ROAD_HALF, ROAD_SHOULDER, BORDER_HEIGHT, TOWN, LAKE, nearestRoad, townDist } from './worldDef';

describe('createBiome(seed).coverAt — existing precedence (baseline, R9)', () => {
  const biome = createBiome(1);

  it('classifies a road point as road even when height/slope alone would read as rock', () => {
    // Regression guard: the mud-ring rule the lake carve is about to add sits AFTER the road
    // check in the plan. If road precedence ever slipped below it, cars on the paved road near
    // the lake would suddenly be classified onto the wrong surface.
    const road = nearestRoad(TOWN.x, TOWN.z);
    expect(road).not.toBeNull();
    expect(road!.dist).toBeLessThan(ROAD_HALF);

    // Both of these values would classify as 'rock' on their own (cliff height, steep slope) —
    // road precedence must still win over them.
    const heightThatWouldBeCliff = BORDER_HEIGHT;
    const slopeThatWouldBeRock = 0.9;
    expect(biome.coverAt(TOWN.x, TOWN.z, heightThatWouldBeCliff, slopeThatWouldBeRock)).toBe('road');
  });

  it('classifies a steep point away from any road or the town plaza as rock', () => {
    // Regression guard: a steep-slope point must still read as un-drivable rock, not as the
    // "high ground" gravel the height-based rule below it would otherwise give — a car reading
    // a cliff face as gravel would drive somewhere it cannot actually climb.
    const x = 60;
    const z = 460;
    const road = nearestRoad(x, z);
    expect(road!.dist).toBeGreaterThan(ROAD_HALF + ROAD_SHOULDER);
    expect(townDist(x, z)).toBeGreaterThan(TOWN.plaza);

    const heightThatWouldBeGravel = 20; // > 12, the "high ground" gravel threshold on its own
    const slopeThatIsSteep = 0.7; // > 0.55, the rock threshold
    expect(biome.coverAt(x, z, heightThatWouldBeGravel, slopeThatIsSteep)).toBe('rock');
  });
});

describe('createBiome(seed).coverAt — the lake shore (baseline, R10–R13)', () => {
  const biome = createBiome(1);
  const flat = 0;
  /** A point `distance` metres south of the lake centre, on open ground away from roads and the town. */
  const southOfLake = (distance: number): [number, number] => {
    const [x, z] = [LAKE.x, LAKE.z + distance];
    expect(nearestRoad(x, z)?.dist).toBeGreaterThan(ROAD_HALF + ROAD_SHOULDER);
    expect(townDist(x, z)).toBeGreaterThan(TOWN.plaza);
    return [x, z];
  };

  it('paints the submerged bed inside the lake as mud', () => {
    expect(biome.coverAt(...southOfLake(18), LAKE.waterLevel + 0.1, flat)).toBe('mud');
  });

  it('paints a wet band just above the waterline as mud, and dry ground above it as not mud', () => {
    const shoreTop = LAKE.waterLevel + 0.9;
    expect(biome.coverAt(...southOfLake(25), shoreTop - 0.1, flat)).toBe('mud');
    expect(biome.coverAt(...southOfLake(25), shoreTop + 0.1, flat)).not.toBe('mud');
  });

  it('never paints low ground outside the lake footprint as its shore', () => {
    expect(biome.coverAt(...southOfLake(LAKE.radius + LAKE.feather + 1), LAKE.waterLevel + 0.7, flat)).not.toBe('mud');
  });

  it('keeps a road a road even when it dips as low as the lake shore', () => {
    const road = nearestRoad(LAKE.x + 56, LAKE.z);
    expect(road?.dist).toBeLessThan(ROAD_HALF);
    expect(biome.coverAt(LAKE.x + 56, LAKE.z, LAKE.waterLevel + 0.1, flat)).toBe('road');
  });
});
