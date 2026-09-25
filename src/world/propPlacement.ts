// src/world/propPlacement.ts
// Where the natural props of one chunk stand. Pure and seeded per chunk, so every caller that
// passes the same input gets the same list, in the same order.
import { mulberry32 } from './rng';
import { CHUNK_SIZE } from './chunk';
import { terrainSurfaceHeight } from './chunkGeometry';
import { surfaceSampleAt } from './surfaceSample';
import * as W from './worldDef';
import type { Height2D } from './noise';
import type { Biome, Cover } from './biome';
import { BOULDER_IDS, type PolyPropId } from './propIds';

export type PlacementLayer = 'base' | 'border' | 'highTier';

export interface PropPlacement {
  modelId: PolyPropId;
  x: number;
  z: number;
  groundY: number;
  yaw: number;
  scale: number;
  layer: PlacementLayer;
  skyline: boolean;
  knockable: boolean;
}

export interface PlacementInput {
  cx: number;
  cz: number;
  seed: number;
  height: Height2D;
  biome: Biome;
  /** Drawn ground height for a collider height; the client passes visualTerrainHeight. */
  drawnHeight: (colliderHeight: number, x: number, z: number) => number;
}

type Random = () => number;

const between = (rng: Random, min: number, max: number): number => min + rng() * (max - min);
const anyBoulder = (rng: Random): PolyPropId => BOULDER_IDS[Math.floor(rng() * BOULDER_IDS.length)];

/** Which Poly Haven prop grows on a cover, or null for bare ground. No cacti: the photo desert has none. */
function pick(cover: Cover, rng: Random): PolyPropId | null {
  const roll = rng();
  switch (cover) {
    case 'forest':
    case 'grass': return roll < 0.45 ? 'wild_rooibos_bush' : roll < 0.6 ? 'dead_tree_trunk_02' : null;
    case 'dirt':
    case 'dryGrass': return roll < 0.3 ? 'wild_rooibos_bush' : roll < 0.4 ? anyBoulder(rng) : roll < 0.5 ? 'namaqualand_stones_01' : null;
    case 'sand': return roll < 0.1 ? anyBoulder(rng) : roll < 0.17 ? 'wild_rooibos_bush' : roll < 0.2 ? 'dead_tree_trunk_02' : roll < 0.24 ? 'namaqualand_stones_01' : null;
    case 'rock':
    case 'gravel': return roll < 0.5 ? anyBoulder(rng) : null;
    case 'snow': return roll < 0.15 ? anyBoulder(rng) : null;
    default: return null; // water / mud / beach / road
  }
}

// The prototype's scatter scale range, and the bigger boulders it lined its long straight with.
const PROP_SCALE = { min: 0.8, max: 1.7 };
// The HDRI hills are heaps of these same boulders, so the border is heaped with them too: loose
// ones at the foot, big ones over the face and the crest, which form the skyline.
const CLIFF_FOOT = { from: 0.5, to: 4, scaleMin: 2.5, scaleMax: 5 };
const CLIFF_FACE = { from: 4, to: 22, scaleMin: 3, scaleMax: 7 };
const CLIFF_ATTEMPTS = 120;
const EXTRA_ATTEMPTS = 10;
// Sinks a boulder's flat base into a slope so no edge of it hangs in the air.
const SLOPE_SINK = 0.25;
const BASE_ATTEMPTS = 14;

/** Margin added to the lake's own footprint (radius + feather) before a prop may be placed — the
 * lake bed and its wet shore must stay loop-able, per the spec's "nothing placed inside the
 * lake's footprint". */
const LAKE_PROP_MARGIN = 2;

/** Whether a natural prop may be placed at (x, z) — false inside the lake's footprint plus margin. */
export function isPropAllowedAt(x: number, z: number): boolean {
  return W.lakeDist(x, z) >= W.LAKE.radius + W.LAKE.feather + LAKE_PROP_MARGIN;
}

function keepsClear(x: number, z: number, feats: W.ChunkFeatures): boolean {
  const road = W.nearestRoad(x, z);
  if (road && road.dist < W.ROAD_HALF + W.ROAD_SHOULDER + 2) return true;
  if (W.townDist(x, z) < W.TOWN.plaza + 4) return true;
  if (W.spawnDist(x, z) < W.SPAWN_KNOLL.top) return true;
  if (W.inSaltFlat(x, z)) return true;
  if (!isPropAllowedAt(x, z)) return true;
  return feats.ramps.some((ramp) => Math.hypot(x - ramp.x, z - ramp.z) < ramp.len + 6);
}

export function propPlacementsInChunk(input: PlacementInput): PropPlacement[] {
  const { cx, cz, seed, height, biome } = input;
  const placements: PropPlacement[] = [];
  const rng = mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ seed) >>> 0);
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;
  const feats = W.featuresInChunk(cx, cz);

  for (let i = 0; i < BASE_ATTEMPTS; i++) {
    const x = ox + rng() * CHUNK_SIZE;
    const z = oz + rng() * CHUNK_SIZE;
    // Keep roads, town plaza, salt flats, the stunt ramps and the lake clear of natural props.
    // The border slope is dressed by its own loop below.
    if (keepsClear(x, z, feats) || W.borderDepth(x, z) > 0) continue;
    const { height: groundHeight, slope } = surfaceSampleAt(height, x, z);
    const id = pick(biome.coverAt(x, z, groundHeight, slope), rng);
    if (!id) continue;
    const scale = between(rng, PROP_SCALE.min, PROP_SCALE.max);
    const yaw = rng() * Math.PI * 2;
    placements.push({ modelId: id, x, z, groundY: groundHeight, yaw, scale, layer: 'base', skyline: false, knockable: id === 'wild_rooibos_bush' });
  }

  // Boulders heaped along the border slope break up its long even face and skyline.
  const cliffRng = mulberry32(((cx * 83492791) ^ (cz * 2971215073) ^ seed ^ 0xc11f) >>> 0);
  for (let i = 0; i < CLIFF_ATTEMPTS; i++) {
    const x = ox + cliffRng() * CHUNK_SIZE;
    const z = oz + cliffRng() * CHUNK_SIZE;
    const outside = W.borderDepth(x, z);
    const band = outside >= CLIFF_FOOT.from && outside <= CLIFF_FOOT.to ? CLIFF_FOOT
      : outside > CLIFF_FACE.from && outside <= CLIFF_FACE.to ? CLIFF_FACE : null;
    if (!band || keepsClear(x, z, feats)) continue;
    const scale = between(cliffRng, band.scaleMin, band.scaleMax);
    const groundY = input.drawnHeight(terrainSurfaceHeight(height, x, z), x, z) - SLOPE_SINK * scale;
    const id = anyBoulder(cliffRng);
    const yaw = cliffRng() * Math.PI * 2;
    placements.push({ modelId: id, x, z, groundY, yaw, scale, layer: 'border', skyline: band === CLIFF_FACE, knockable: false });
  }

  // The prototype's high tier adds a second, denser layer; here only bushes and stones, so the
  // tiers never disagree about what the car can hit.
  const extraRng = mulberry32(((cx * 19990303) ^ (cz * 83492791) ^ seed ^ 0xe7a) >>> 0);
  for (let i = 0; i < EXTRA_ATTEMPTS; i++) {
    const x = ox + extraRng() * CHUNK_SIZE;
    const z = oz + extraRng() * CHUNK_SIZE;
    if (keepsClear(x, z, feats) || W.borderDepth(x, z) > 0) continue;
    const { height: groundHeight, slope } = surfaceSampleAt(height, x, z);
    const cover = biome.coverAt(x, z, groundHeight, slope);
    if (cover !== 'sand' && cover !== 'dirt' && cover !== 'dryGrass') continue;
    const id: PolyPropId = extraRng() < 0.6 ? 'wild_rooibos_bush' : 'namaqualand_stones_01';
    const scale = between(extraRng, PROP_SCALE.min, PROP_SCALE.max);
    const yaw = extraRng() * Math.PI * 2;
    placements.push({ modelId: id, x, z, groundY: groundHeight, yaw, scale, layer: 'highTier', skyline: false, knockable: id === 'wild_rooibos_bush' });
  }

  return placements;
}
