// src/physics/physicsWorld.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { addChunkCollider, toColumnMajor } from './physicsWorld';
import { CHUNK_SIZE, chunkOrigin, type ChunkCoord } from '../world/chunk';
import { generateChunkHeights } from '../world/heightfieldData';
import { terrainSurfaceHeight } from '../world/chunkGeometry';
import { createHeightField, type Height2D } from '../world/noise';
import { SPAWN } from '../world/worldDef';
import { mulberry32 } from '../world/rng';

describe('toColumnMajor — the grid order a Rapier heightfield reads (S0-1)', () => {
  it('transposes a 3 × 3 row-major grid and keeps its length', () => {
    const rowMajor = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...toColumnMajor(rowMajor, 3)]).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });

  it('leaves the input grid unchanged', () => {
    const rowMajor = new Float32Array([1, 2, 3, 4]);
    toColumnMajor(rowMajor, 2);
    expect([...rowMajor]).toEqual([1, 2, 3, 4]);
  });

  it('throws for a grid that is not the given size', () => {
    expect(() => toColumnMajor(new Float32Array(8), 3)).toThrow('is not a 3 × 3 grid');
  });
});

describe('addChunkCollider — the collider is exactly the drawn ground (S0-1 gate)', () => {
  const TOLERANCE = 1e-4;
  const RAYS = 2000;

  beforeAll(async () => {
    await RAPIER.init();
  });

  /** Largest gap between where a downward ray hits the collider and terrainSurfaceHeight. */
  function worstGap(height: Height2D, chunk: ChunkCoord): { worst: number; misses: number } {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const origin = chunkOrigin(chunk);
    addChunkCollider(world, generateChunkHeights(height, chunk), origin.x, origin.z);
    world.step();
    const random = mulberry32(0xf1e1d + chunk.cx * 31 + chunk.cz);
    let worst = 0;
    let misses = 0;
    for (let ray = 0; ray < RAYS; ray++) {
      // A quarter of the rays land on grid lines, including the chunk's own border lines.
      const onLine = ray % 4 === 0;
      const localX = onLine ? Math.floor(random() * (CHUNK_SIZE + 1)) : random() * CHUNK_SIZE;
      const localZ = ray % 8 === 0 ? Math.floor(random() * (CHUNK_SIZE + 1)) : random() * CHUNK_SIZE;
      const x = origin.x + localX;
      const z = origin.z + localZ;
      const hit = world.castRay(new RAPIER.Ray({ x, y: 1000, z }, { x: 0, y: -1, z: 0 }), 2000, true);
      if (!hit) {
        misses++;
        continue;
      }
      worst = Math.max(worst, Math.abs(1000 - hit.timeOfImpact - terrainSurfaceHeight(height, x, z)));
    }
    return { worst, misses };
  }

  it('matches the ground of a chunk at the spawn', () => {
    const spawnChunk = { cx: Math.floor(SPAWN.x / CHUNK_SIZE), cz: Math.floor(SPAWN.z / CHUNK_SIZE) };
    const { worst, misses } = worstGap(createHeightField(1), spawnChunk);
    expect(misses).toBe(0);
    expect(worst).toBeLessThan(TOLERANCE);
  });

  it('matches the ground of a chunk at negative x (outside the map, under the far layer)', () => {
    const { worst, misses } = worstGap(createHeightField(1), { cx: -1, cz: 2 });
    expect(misses).toBe(0);
    expect(worst).toBeLessThan(TOLERANCE);
  });

  it('matches a steep, faceted synthetic ground with slopes up to 5', () => {
    // Sharp ridges every 3 m across x and a gentler wave along z: a wrong cell diagonal or a
    // transposed grid shows here as metres of error, not millimetres.
    const steep: Height2D = (x, z) => 5 * Math.abs(((x % 6) + 6) % 6 - 3) + 0.4 * Math.sin(z * 0.7) + 0.3 * Math.floor(z / 5);
    const { worst, misses } = worstGap(steep, { cx: 1, cz: -1 });
    expect(misses).toBe(0);
    expect(worst).toBeLessThan(TOLERANCE);
  });
});
