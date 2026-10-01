// src/world/forestTrees.ts
// Deterministic procedural tree placement in the Bosveld forest biome per chunk.
// Thin trees are knockable (break/tilt on impact); thick trees are solid obstacles.
import { CHUNK_SIZE } from './chunk';
import { forestWeight } from './terrain/forest';
import { nearestRoad, ROAD_HALF } from './worldDef';
import { nearestTrack } from './terrain/tracks';
import { riverSampleAt } from './terrain/river';
import { mulberry32 } from './rng';

export interface TreeFeature {
  x: number;
  z: number;
  trunkRadius: number;
  height: number;
  kind: 'pine' | 'broadleaf';
  solid: boolean;
  knockable: boolean;
  yaw: number;
}

const TREE_SPACING = 3.5;

export function treesInChunk(cx: number, cz: number): TreeFeature[] {
  const minX = cx * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  const centerX = minX + CHUNK_SIZE / 2;
  const centerZ = minZ + CHUNK_SIZE / 2;

  // Quick check: if whole chunk is far from forest, return empty
  if (
    forestWeight(centerX, centerZ) === 0 &&
    forestWeight(minX, minZ) === 0 &&
    forestWeight(minX + CHUNK_SIZE, minZ) === 0 &&
    forestWeight(minX, minZ + CHUNK_SIZE) === 0 &&
    forestWeight(minX + CHUNK_SIZE, minZ + CHUNK_SIZE) === 0
  ) {
    return [];
  }

  const rng = mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ 0xa8f2b) >>> 0);
  const trees: TreeFeature[] = [];
  const count = 18 + Math.floor(rng() * 14); // 18 to 31 trees per chunk

  for (let i = 0; i < count; i++) {
    const x = minX + 3 + rng() * (CHUNK_SIZE - 6);
    const z = minZ + 3 + rng() * (CHUNK_SIZE - 6);

    const fw = forestWeight(x, z);
    if (fw < 0.15 || rng() > fw) continue;

    // Keep clear of roads and tracks
    if (nearestRoad(x, z, ROAD_HALF + 4.0)) continue;
    if (nearestTrack(x, z, 3.0)) continue;

    // Keep clear of river bed and water
    const river = riverSampleAt(x, z);
    if (river && river.zone === 'bed') continue;

    // Proximity check against already placed trees in this chunk
    let tooClose = false;
    for (const other of trees) {
      if (Math.hypot(other.x - x, other.z - z) < TREE_SPACING) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const kind: 'pine' | 'broadleaf' = rng() < 0.65 ? 'pine' : 'broadleaf';
    const isSolid = rng() < 0.35; // 35% thick solid trees, 65% thin knockable

    if (isSolid) {
      const trunkRadius = 0.45 + rng() * 0.35; // 0.45 to 0.8m
      const height = 11 + rng() * 6; // 11 to 17m
      trees.push({
        x, z,
        trunkRadius,
        height,
        kind,
        solid: true,
        knockable: false,
        yaw: rng() * Math.PI * 2,
      });
    } else {
      const trunkRadius = 0.12 + rng() * 0.1; // 0.12 to 0.22m
      const height = 6 + rng() * 4; // 6 to 10m
      trees.push({
        x, z,
        trunkRadius,
        height,
        kind,
        solid: false,
        knockable: true,
        yaw: rng() * Math.PI * 2,
      });
    }
  }

  return trees;
}
