// src/render/farTerrain.test.ts
import { describe, it, expect } from 'vitest';
import { FarTerrain, farVertexColor, type LinearColor } from './farTerrain';
import { buildTerrainMesh } from './terrainMesh';
import { COVER_IDS, coverIndex, createBiome, type Cover } from '../world/biome';
import { generateFarGrid } from '../world/farGrid';
import { generateChunkSurface } from '../world/chunkSurface';
import { createHeightField } from '../world/noise';
import { CHUNK_SIZE, chunkOrigin, type ChunkCoord } from '../world/chunk';
import { VERTS_PER_SIDE } from '../world/heightfieldData';

const SAND_MEAN: LinearColor = { r: 0.6, g: 0.4, b: 0.2 };
const height = createHeightField(1);
const biome = createBiome(1);

/** The tint the near chunk mesh gives a flat vertex of this cover in the open valley. */
function nearTint(cover: Cover): number {
  const vertices = VERTS_PER_SIDE * VERTS_PER_SIDE;
  const surface = { heights: new Float32Array(vertices), covers: new Uint8Array(vertices).fill(coverIndex(cover)), tints: new Uint8Array(vertices) };
  const mesh = buildTerrainMesh(surface, 1536, 1536);
  return mesh.geometry.getAttribute('color').getX(VERTS_PER_SIDE * 32 + 32);
}

describe('farVertexColor — far ground colour per cover (S1-3)', () => {
  it('shades every cover like the near chunks, so the far/near seam does not show', () => {
    for (const cover of COVER_IDS) {
      const far = farVertexColor(cover, SAND_MEAN);
      const tint = nearTint(cover);
      // The near tint travels in a 32-bit float attribute.
      expect(far.r, cover).toBeCloseTo(SAND_MEAN.r * tint, 6);
      expect(far.g, cover).toBeCloseTo(SAND_MEAN.g * tint, 6);
      expect(far.b, cover).toBeCloseTo(SAND_MEAN.b * tint, 6);
    }
  });

  it('follows the measured sand colour: a brighter sand texture gives brighter far ground', () => {
    const bright = farVertexColor('gravel', { r: 0.9, g: 0.8, b: 0.4 });
    const dim = farVertexColor('gravel', { r: 0.45, g: 0.4, b: 0.2 });
    expect(bright.r).toBeCloseTo(dim.r * 2, 9);
    expect(bright.g).toBeCloseTo(dim.g * 2, 9);
    expect(bright.b).toBeCloseTo(dim.b * 2, 9);
  });
});

describe('FarTerrain — the far layer meets the near chunks (S1-3)', () => {
  const grid = generateFarGrid(height, biome, { step: CHUNK_SIZE, margin: 2 * CHUNK_SIZE });
  const far = new FarTerrain(grid, { sandMean: SAND_MEAN, rockMean: { r: 0.3, g: 0.3, b: 0.3 } });
  const farPositions = far.mesh.geometry.getAttribute('position');

  function farHeightAt(x: number, z: number): number {
    const column = Math.round((x - grid.originX) / grid.step);
    const row = Math.round((z - grid.originZ) / grid.step);
    const vertex = row * grid.verticesPerSide + column;
    expect(farPositions.getX(vertex)).toBe(x);
    expect(farPositions.getZ(vertex)).toBe(z);
    return farPositions.getY(vertex);
  }

  it.each<[string, ChunkCoord]>([
    ['in the valley', { cx: 24, cz: 31 }],
    ['on the north face', { cx: 20, cz: 1 }],
    ['past the west edge, where the ground falls away', { cx: -1, cz: 20 }],
  ])('draws the corners of a chunk %s at the same height as the near mesh', (_name, chunk) => {
    const origin = chunkOrigin(chunk);
    const near = buildTerrainMesh(generateChunkSurface(height, biome, chunk), origin.x, origin.z).geometry.getAttribute('position');
    const last = VERTS_PER_SIDE - 1;
    for (const [column, row] of [[0, 0], [last, 0], [0, last], [last, last]]) {
      const vertex = row * VERTS_PER_SIDE + column;
      expect(farHeightAt(near.getX(vertex), near.getZ(vertex))).toBeCloseTo(near.getY(vertex), 4);
    }
  });

  it('covers the whole map and its margin with one mesh', () => {
    far.mesh.geometry.computeBoundingBox();
    const box = far.mesh.geometry.boundingBox;
    expect(box?.min.x).toBe(-2 * CHUNK_SIZE);
    expect(box?.max.z).toBe(3072 + 2 * CHUNK_SIZE);
  });
});
