// src/world/propPlacement.test.ts
// Retired with the old map: the lake keep-clear rows (isPropAllowedAt; there is no lake in S1).
import { describe, it, expect } from 'vitest';
import { propPlacementsInChunk, type PlacementInput, type PropPlacement } from './propPlacement';
import { createHeightField } from './noise';
import { createBiome } from './biome';
import { borderFaceDepth, isPropExcluded, nearestRoad, ROAD_HALF, ROAD_SHOULDER, SPAWN } from './worldDef';
import { propColliderBox } from './propColliders';
import { worldToChunk, type ChunkCoord } from './chunk';
import { terrainSurfaceHeight } from './chunkGeometry';
import { BOULDER_IDS, type PolyPropId } from './propIds';

const height = createHeightField(1);
const biome = createBiome(1);
const collider = (colliderHeight: number): number => colliderHeight;

const inputFor = (chunk: ChunkCoord, drawnHeight: PlacementInput['drawnHeight'] = collider): PlacementInput =>
  ({ cx: chunk.cx, cz: chunk.cz, seed: 1, height, biome, drawnHeight });

// The spawn, a strip across the north face (plain, apron, foot, face, crest) and open plain.
const SPAWN_CHUNK = worldToChunk(SPAWN.x, SPAWN.z);
const CHUNKS: readonly ChunkCoord[] = [
  SPAWN_CHUNK,
  ...[0, 1, 2, 3, 4].flatMap((cz) => [10, 11, 12].map((cx) => ({ cx, cz }))),
  { cx: 15, cz: 20 }, { cx: 30, cz: 30 }, { cx: 8, cz: 25 },
];
const ALL: readonly PropPlacement[] = CHUNKS.flatMap((chunk) => propPlacementsInChunk(inputFor(chunk)));
const ofLayer = (layer: PropPlacement['layer']): PropPlacement[] => ALL.filter((placement) => placement.layer === layer);
const isBoulder = (id: PolyPropId): boolean => BOULDER_IDS.includes(id);

describe('propPlacementsInChunk — where the natural props stand (R2, S1-1)', () => {
  it('places props in every layer across the sampled chunks', () => {
    expect(ofLayer('base').length).toBeGreaterThan(0);
    expect(ofLayer('border').length).toBeGreaterThan(0);
    expect(ofLayer('highTier').length).toBeGreaterThan(0);
  });

  it('gives the same list, in the same order, for the same input (client and server agree)', () => {
    for (const chunk of CHUNKS) expect(propPlacementsInChunk(inputFor(chunk))).toEqual(propPlacementsInChunk(inputFor(chunk)));
  });

  it('keeps the spawn top and every spawn slot clear', () => {
    for (const placement of ALL) expect(isPropExcluded(placement.x, placement.z)).toBe(false);
  });

  it('keeps each placement inside its own chunk', () => {
    for (const chunk of CHUNKS) {
      for (const placement of propPlacementsInChunk(inputFor(chunk))) expect(worldToChunk(placement.x, placement.z)).toEqual(chunk);
    }
  });

  it('heaps border boulders only around the face foot and up the face, never out on the plain', () => {
    for (const placement of ofLayer('border')) {
      const depth = borderFaceDepth(placement.x, placement.z);
      expect(depth).toBeGreaterThanOrEqual(-4);
      expect(depth).toBeLessThanOrEqual(26);
      expect(isBoulder(placement.modelId)).toBe(true);
    }
  });

  it('keeps the valley props off the border face, which the border layer dresses', () => {
    for (const placement of [...ofLayer('base'), ...ofLayer('highTier')]) expect(borderFaceDepth(placement.x, placement.z)).toBeLessThanOrEqual(0);
  });

  it('adds only bushes and stones in the high tier, so the tiers never differ in what a car can hit', () => {
    for (const placement of ofLayer('highTier')) expect(['wild_rooibos_bush', 'namaqualand_stones_01']).toContain(placement.modelId);
  });

  it('never makes a boulder knockable', () => {
    for (const placement of ALL) if (isBoulder(placement.modelId)) expect(placement.knockable).toBe(false);
  });

  it('stands the valley props on the collider ground', () => {
    for (const placement of ofLayer('base')) expect(placement.groundY).toBeCloseTo(terrainSurfaceHeight(height, placement.x, placement.z), 6);
  });

  // Replacement (S3-2): the border boulders at the face foot are solid now, so they stand on the
  // collider; only the drawn-only boulders higher up the face still follow the drawn ground.
  it('moves only the non-solid border boulders with the drawn ground; valley props and solids do not depend on it', () => {
    // Regression: the client passes its drawn height; the server must still get the same solids,
    // or a boulder stops the car on one side and not on the other.
    const lifted = (colliderHeight: number): number => colliderHeight + 5;
    let drawnOnly = 0;
    let solidBorder = 0;
    for (const chunk of CHUNKS) {
      const plain = propPlacementsInChunk(inputFor(chunk));
      const drawn = propPlacementsInChunk(inputFor(chunk, lifted));
      const followsDrawn = (placement: PropPlacement): boolean => placement.layer === 'border' && !placement.solid;
      expect(drawn.filter((placement) => !followsDrawn(placement))).toEqual(plain.filter((placement) => !followsDrawn(placement)));
      const plainDrawnOnly = plain.filter(followsDrawn);
      const liftedDrawnOnly = drawn.filter(followsDrawn);
      expect(liftedDrawnOnly).toHaveLength(plainDrawnOnly.length);
      liftedDrawnOnly.forEach((placement, index) => expect(placement.groundY - plainDrawnOnly[index].groundY).toBeCloseTo(5, 6));
      drawnOnly += plainDrawnOnly.length;
      solidBorder += plain.filter((placement) => placement.layer === 'border' && placement.solid).length;
    }
    // Both kinds must be in the sample, or the rows above check nothing.
    expect(drawnOnly).toBeGreaterThan(0);
    expect(solidBorder).toBeGreaterThan(0);
  });
});

// Chunks the rock zones cover whole: three on Groot Koppie, two on the dolerite ridge.
const KOPPIE_CHUNKS: readonly ChunkCoord[] = [{ cx: 22, cz: 8 }, { cx: 23, cz: 9 }, { cx: 23, cz: 10 }, { cx: 24, cz: 10 }, { cx: 22, cz: 9 }];
const RIDGE_CHUNKS: readonly ChunkCoord[] = [{ cx: 31, cz: 32 }, { cx: 42, cz: 34 }];
// Chunks a road or a track crosses inside or next to a rock zone: the Koppie Klim and the poort track.
const LANE_CHUNKS: readonly ChunkCoord[] = [{ cx: 25, cz: 11 }, { cx: 25, cz: 12 }, { cx: 24, cz: 10 }, { cx: 36, cz: 32 }, { cx: 37, cz: 34 }, { cx: 24, cz: 14 }];
const SOLID_SAMPLE: readonly PropPlacement[] = [...CHUNKS, ...KOPPIE_CHUNKS, ...RIDGE_CHUNKS, ...LANE_CHUNKS]
  .flatMap((chunk) => propPlacementsInChunk(inputFor(chunk)))
  .filter((placement) => placement.solid);

describe('propPlacementsInChunk — the rock zones and the shared solids (S3-2)', () => {
  it.each(KOPPIE_CHUNKS)('fills a koppie chunk ($cx, $cz) with 25–35 rock props, at least 60 % of them boulders', (chunk) => {
    const rock = propPlacementsInChunk(inputFor(chunk)).filter((placement) => placement.layer === 'rock');
    expect(rock.length).toBeGreaterThanOrEqual(25);
    expect(rock.length).toBeLessThanOrEqual(35);
    expect(rock.filter((placement) => isBoulder(placement.modelId)).length / rock.length).toBeGreaterThanOrEqual(0.6);
  });

  it.each(RIDGE_CHUNKS)('makes the boulders of a ridge chunk ($cx, $cz) dolerite and those of a koppie granite', (chunk) => {
    const ridgeBoulders = propPlacementsInChunk(inputFor(chunk)).filter((placement) => isBoulder(placement.modelId));
    const koppieBoulders = propPlacementsInChunk(inputFor(KOPPIE_CHUNKS[0])).filter((placement) => isBoulder(placement.modelId));
    expect(ridgeBoulders.length).toBeGreaterThan(0);
    for (const placement of ridgeBoulders) expect(placement.rock).toBe('dolerite');
    for (const placement of koppieBoulders) expect(placement.rock).toBe('granite');
  });

  it('gives a rock only to boulders', () => {
    for (const placement of [...ALL, ...SOLID_SAMPLE]) expect(placement.rock === null).toBe(!isBoulder(placement.modelId));
  });

  it('makes every boulder off the border face solid, and never a bush or the loose stones', () => {
    const everything = [...CHUNKS, ...KOPPIE_CHUNKS].flatMap((chunk) => propPlacementsInChunk(inputFor(chunk)));
    for (const placement of everything) {
      if (placement.modelId === 'wild_rooibos_bush' || placement.modelId === 'namaqualand_stones_01') expect(placement.solid).toBe(false);
      if (isBoulder(placement.modelId) && placement.layer !== 'border') expect(placement.solid).toBe(true);
    }
  });

  it('stands every solid on the collider ground, lowered by its own sink (never on the drawn border height)', () => {
    expect(SOLID_SAMPLE.length).toBeGreaterThan(0);
    for (const placement of SOLID_SAMPLE) {
      expect(placement.groundY + placement.sink).toBeCloseTo(terrainSurfaceHeight(height, placement.x, placement.z), 6);
      expect(placement.sink).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the whole collider box of every solid off the roads, the tracks, the pads and the jump landings', () => {
    // A boulder whose centre is clear but whose side reaches the lane stops a car on the road.
    const roadEdge = ROAD_HALF + ROAD_SHOULDER;
    for (const placement of SOLID_SAMPLE) {
      const box = propColliderBox(placement);
      if (!box) throw new Error(`${placement.modelId} is solid but has no collider box`);
      const cos = Math.cos(box.yaw);
      const sin = Math.sin(box.yaw);
      const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]].map(([alongX, alongZ]) => ({
        x: box.x + alongX * box.halfX * cos + alongZ * box.halfZ * sin,
        z: box.z - alongX * box.halfX * sin + alongZ * box.halfZ * cos,
      }));
      for (const corner of corners) {
        expect(isPropExcluded(corner.x, corner.z), `${placement.modelId} at (${placement.x.toFixed(1)}, ${placement.z.toFixed(1)})`).toBe(false);
        expect(nearestRoad(corner.x, corner.z, roadEdge), `${placement.modelId} at (${placement.x.toFixed(1)}, ${placement.z.toFixed(1)})`).toBeNull();
      }
    }
  });
});
