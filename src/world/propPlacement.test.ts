// src/world/propPlacement.test.ts
// Retired with the old map: the lake keep-clear rows (isPropAllowedAt; there is no lake in S1).
import { describe, it, expect } from 'vitest';
import { propPlacementsInChunk, type PlacementInput, type PropPlacement } from './propPlacement';
import { createHeightField } from './noise';
import { createBiome } from './biome';
import { borderFaceDepth, isPropExcluded, SPAWN } from './worldDef';
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

  it('moves only the border boulders with the drawn ground; the valley props do not depend on it', () => {
    // Regression: the client passes its drawn height; the server must still get the same valley props.
    const lifted = (colliderHeight: number): number => colliderHeight + 5;
    for (const chunk of CHUNKS) {
      const plain = propPlacementsInChunk(inputFor(chunk));
      const drawn = propPlacementsInChunk(inputFor(chunk, lifted));
      expect(drawn.filter((placement) => placement.layer !== 'border')).toEqual(plain.filter((placement) => placement.layer !== 'border'));
      const plainBorder = plain.filter((placement) => placement.layer === 'border');
      const drawnBorder = drawn.filter((placement) => placement.layer === 'border');
      expect(drawnBorder).toHaveLength(plainBorder.length);
      drawnBorder.forEach((placement, index) => expect(placement.groundY - plainBorder[index].groundY).toBeCloseTo(5, 6));
    }
  });
});
