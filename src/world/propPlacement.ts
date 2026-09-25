// src/world/propPlacement.ts
// Where the natural props of one chunk stand. Pure and seeded per chunk, so every caller that
// passes the same input gets the same list, in the same order. The solid ones are the boulders and
// logs the client and the server both build colliders for.
import { mulberry32 } from './rng';
import { CHUNK_SIZE } from './chunk';
import { terrainSurfaceHeight } from './chunkGeometry';
import { surfaceSampleAt } from './surfaceSample';
import * as W from './worldDef';
import type { Height2D } from './noise';
import type { Biome, Cover } from './biome';
import { koppieBandAt } from './terrain/landforms';
import { BOULDER_IDS, type PolyPropId } from './propIds';
import { propFootprintRadius, propHeight, PROP_COLLIDER_SHAPES } from './propColliders';

export type PlacementLayer = 'base' | 'border' | 'rock' | 'highTier';

export interface PropPlacement {
  modelId: PolyPropId;
  x: number;
  z: number;
  /** Height of the model's origin: for a solid, the collider ground at (x, z) minus `sink`. */
  groundY: number;
  /** Metres the model is pushed into the ground, so no edge hangs in the air and some boulders sit half buried. */
  sink: number;
  yaw: number;
  scale: number;
  layer: PlacementLayer;
  /** Drawn at any distance: it shapes a skyline or a koppie's outline. */
  skyline: boolean;
  knockable: boolean;
  /** Stops a car, on the client and on the server alike. */
  solid: boolean;
  /** The rock a boulder is made of, for its tint; null for anything that is not a boulder. */
  rock: W.RockKind | null;
}

export interface PlacementInput {
  cx: number;
  cz: number;
  seed: number;
  height: Height2D;
  biome: Biome;
  /** Drawn ground height for a collider height; the client passes visualTerrainHeight. Solids never read it. */
  drawnHeight: (colliderHeight: number, x: number, z: number) => number;
}

type Random = () => number;

const between = (rng: Random, min: number, max: number): number => min + rng() * (max - min);
const anyBoulder = (rng: Random): PolyPropId => BOULDER_IDS[Math.floor(rng() * BOULDER_IDS.length)];
const isBoulder = (id: PolyPropId): boolean => BOULDER_IDS.includes(id);

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
// ones around the foot of the face, big ones up the face, measured past the face foot.
const CLIFF_FOOT = { from: -4, to: 4, scaleMin: 2.5, scaleMax: 5 };
const CLIFF_FACE = { from: 4, to: 26, scaleMin: 3, scaleMax: 7 };
const CLIFF_ATTEMPTS = 120;
const EXTRA_ATTEMPTS = 10;
// Sinks a boulder's flat base into a slope so no edge of it hangs in the air.
const SLOPE_SINK = 0.25;
const BASE_ATTEMPTS = 14;
/** Room past a solid's footprint kept clear of every road, track and lane. */
const FOOTPRINT_MARGIN = 0.5;
const FOOTPRINT_POINTS = 8;

// ── rock zones: koppies, the poort and the dolerite ridge (design §3 Z2, Z3, Z10) ─────────
interface RockZoneDensity {
  /** Props in a chunk the zone covers whole; a chunk it covers in part gets its share. */
  count: { min: number; max: number };
  /** Share of the props that are boulders; the rest are bushes, stones and dead trees. */
  boulderShare: number;
  scale: { min: number; max: number };
}

const ROCK_ZONE_DENSITY: Readonly<Record<W.RockZone, RockZoneDensity>> = {
  koppie: { count: { min: 25, max: 35 }, boulderShare: 0.7, scale: { min: 0.8, max: 2 } },
  poort: { count: { min: 20, max: 20 }, boulderShare: 1, scale: { min: 0.8, max: 1.8 } },
  ridge: { count: { min: 20, max: 20 }, boulderShare: 1, scale: { min: 0.9, max: 2.2 } },
};
const ROCK_ZONES: readonly W.RockZone[] = ['koppie', 'poort', 'ridge'];
/** The zone share of a chunk is read on this many cells a side. */
const ZONE_GRID = 8;
/** Random points tried per prop the zone still wants. */
const ROCK_ATTEMPTS_PER_PROP = 6;
/** How much of its height a slope may push a rock prop into the ground. */
const MAX_SINK_SHARE = 0.6;

/**
 * Boulder heaps along a koppie's rock band, so it does not read as one even wall from the plain:
 * big ones on its crest break the outline, half-buried ones stand out of its face, smaller ones
 * gather at its foot. Metres from the crest; the face is the part between crest and foot.
 */
const BAND_HEAPS = {
  crest: { scale: { min: 3.2, max: 6.5 } },
  face: { scale: { min: 2.2, max: 4.5 } },
  foot: { scale: { min: 1, max: 2.8 } },
  /** The crest part reaches this far onto the shoulder, and the foot part this far out onto the apron. */
  crestReach: 6,
  footReach: 8,
  attempts: 40,
  members: { min: 3, max: 5 },
  spread: 7,
  /** Chance that a heap boulder sits half buried, and how much of its height is then under ground. */
  buried: { chance: 0.4, share: { min: 0.25, max: 0.5 } },
} as const;

type BandPart = 'crest' | 'face' | 'foot';

function bandPartAt(x: number, z: number): BandPart | null {
  const band = koppieBandAt(x, z);
  if (!band) return null;
  if (band.fromCrest < -BAND_HEAPS.crestReach || band.fromCrest > band.width + BAND_HEAPS.footReach) return null;
  // The outer quarter of the band is its foot, the inner quarter and the shoulder edge its crest.
  const share = band.fromCrest / band.width;
  return share < 0.25 ? 'crest' : share < 0.75 ? 'face' : 'foot';
}

function keepsClear(x: number, z: number): boolean {
  if (W.isPropExcluded(x, z)) return true;
  const road = W.nearestRoad(x, z, W.ROAD_HALF + W.ROAD_SHOULDER + 2);
  return road !== null;
}

/** True when any part of a solid's footprint would touch a keep-clear area, not only its centre. */
function footprintKeepsClear(modelId: PolyPropId, scale: number, x: number, z: number): boolean {
  if (keepsClear(x, z)) return true;
  const radius = propFootprintRadius(modelId, scale);
  if (radius <= 0) return false;
  const reach = radius + FOOTPRINT_MARGIN;
  for (let index = 0; index < FOOTPRINT_POINTS; index++) {
    const angle = (index / FOOTPRINT_POINTS) * Math.PI * 2;
    if (keepsClear(x + reach * Math.cos(angle), z + reach * Math.sin(angle))) return true;
  }
  return false;
}

const isSolidModel = (id: PolyPropId): boolean => PROP_COLLIDER_SHAPES[id] !== null;

/** Dolerite where the ridge stands, granite on every other boulder of this map. */
function boulderRock(id: PolyPropId, x: number, z: number): W.RockKind | null {
  if (!isBoulder(id)) return null;
  return W.rockKindAt(x, z) === 'dolerite' ? 'dolerite' : 'granite';
}

function insideChunk(ox: number, oz: number, x: number, z: number): boolean {
  return x >= ox && x < ox + CHUNK_SIZE && z >= oz && z < oz + CHUNK_SIZE;
}

/** How many cells of the chunk's grid each rock zone takes. */
function rockZoneCells(ox: number, oz: number): Map<W.RockZone, number> {
  const cells = new Map<W.RockZone, number>();
  const cell = CHUNK_SIZE / ZONE_GRID;
  for (let row = 0; row < ZONE_GRID; row++) {
    for (let column = 0; column < ZONE_GRID; column++) {
      const zone = W.rockZoneAt(ox + (column + 0.5) * cell, oz + (row + 0.5) * cell);
      if (zone) cells.set(zone, (cells.get(zone) ?? 0) + 1);
    }
  }
  return cells;
}

interface RockProp {
  modelId: PolyPropId;
  x: number;
  z: number;
  scale: number;
  yaw: number;
  /** Share of the model's height set under ground on top of what the slope needs. */
  buried: number;
  skyline: boolean;
}

function rockPlacement(height: Height2D, prop: RockProp): PropPlacement {
  const { height: ground, slope } = surfaceSampleAt(height, prop.x, prop.z);
  const modelHeight = propHeight(prop.modelId, prop.scale);
  const slopeSink = slope * propFootprintRadius(prop.modelId, prop.scale) * SLOPE_SINK;
  const sink = Math.min(MAX_SINK_SHARE * modelHeight, slopeSink + prop.buried * modelHeight);
  return {
    modelId: prop.modelId,
    x: prop.x,
    z: prop.z,
    groundY: ground - sink,
    sink,
    yaw: prop.yaw,
    scale: prop.scale,
    layer: 'rock',
    skyline: prop.skyline,
    knockable: prop.modelId === 'wild_rooibos_bush',
    solid: isSolidModel(prop.modelId),
    rock: boulderRock(prop.modelId, prop.x, prop.z),
  };
}

/** The non-boulder share of a koppie: bushes in the cracks, loose stones, now and then a dead tree. */
function koppieFiller(rng: Random): PolyPropId {
  const roll = rng();
  return roll < 0.5 ? 'wild_rooibos_bush' : roll < 0.8 ? 'namaqualand_stones_01' : 'dead_tree_trunk_02';
}

/** A spot where a prop of the zone may stand: inside the chunk, in the zone, off the border face and clear of every lane. */
function rockSpotFree(zone: W.RockZone, modelId: PolyPropId, scale: number, x: number, z: number, ox: number, oz: number): boolean {
  if (!insideChunk(ox, oz, x, z) || W.borderFaceDepth(x, z) > 0) return false;
  if (W.rockZoneAt(x, z) !== zone) return false;
  return isSolidModel(modelId) ? !footprintKeepsClear(modelId, scale, x, z) : !keepsClear(x, z);
}

function rockZoneProps(zone: W.RockZone, share: number, rng: Random, ox: number, oz: number): RockProp[] {
  const density = ROCK_ZONE_DENSITY[zone];
  const full = density.count.min + Math.floor(rng() * (density.count.max - density.count.min + 1));
  const wanted = Math.round(full * share);
  // Boulders take the first slots, so a chunk that runs out of room keeps its boulder share.
  const boulders = Math.ceil(wanted * density.boulderShare);
  const props: RockProp[] = [];

  if (zone === 'koppie') {
    for (let attempt = 0; attempt < BAND_HEAPS.attempts && props.length < boulders; attempt++) {
      const heapX = ox + rng() * CHUNK_SIZE;
      const heapZ = oz + rng() * CHUNK_SIZE;
      const part = bandPartAt(heapX, heapZ);
      if (!part) continue;
      const band = BAND_HEAPS[part];
      const members = BAND_HEAPS.members.min + Math.floor(rng() * (BAND_HEAPS.members.max - BAND_HEAPS.members.min + 1));
      for (let member = 0; member < members && props.length < boulders; member++) {
        const angle = rng() * Math.PI * 2;
        const distance = member === 0 ? 0 : rng() * BAND_HEAPS.spread;
        const x = heapX + distance * Math.cos(angle);
        const z = heapZ + distance * Math.sin(angle);
        const modelId = anyBoulder(rng);
        const scale = between(rng, band.scale.min, band.scale.max);
        const yaw = rng() * Math.PI * 2;
        const buried = rng() < BAND_HEAPS.buried.chance ? between(rng, BAND_HEAPS.buried.share.min, BAND_HEAPS.buried.share.max) : 0;
        if (!rockSpotFree(zone, modelId, scale, x, z, ox, oz)) continue;
        props.push({ modelId, x, z, scale, yaw, buried, skyline: true });
      }
    }
  }

  const attempts = Math.max(0, wanted - props.length) * ROCK_ATTEMPTS_PER_PROP;
  for (let attempt = 0; attempt < attempts && props.length < wanted; attempt++) {
    const x = ox + rng() * CHUNK_SIZE;
    const z = oz + rng() * CHUNK_SIZE;
    const modelId = props.length < boulders ? anyBoulder(rng) : koppieFiller(rng);
    const scale = isBoulder(modelId) ? between(rng, density.scale.min, density.scale.max) : between(rng, PROP_SCALE.min, PROP_SCALE.max);
    const yaw = rng() * Math.PI * 2;
    if (!rockSpotFree(zone, modelId, scale, x, z, ox, oz)) continue;
    props.push({ modelId, x, z, scale, yaw, buried: 0, skyline: false });
  }
  return props;
}

export function propPlacementsInChunk(input: PlacementInput): PropPlacement[] {
  const { cx, cz, seed, height, biome } = input;
  const placements: PropPlacement[] = [];
  const rng = mulberry32(((cx * 73856093) ^ (cz * 19349663) ^ seed) >>> 0);
  const ox = cx * CHUNK_SIZE;
  const oz = cz * CHUNK_SIZE;

  for (let i = 0; i < BASE_ATTEMPTS; i++) {
    const x = ox + rng() * CHUNK_SIZE;
    const z = oz + rng() * CHUNK_SIZE;
    // The border face is dressed by its own loop below, and the rock zones by theirs.
    if (keepsClear(x, z) || W.borderFaceDepth(x, z) > 0 || W.rockZoneAt(x, z) !== null) continue;
    const { height: groundHeight, slope } = surfaceSampleAt(height, x, z);
    const id = pick(biome.coverAt(x, z, groundHeight, slope), rng);
    if (!id) continue;
    const scale = between(rng, PROP_SCALE.min, PROP_SCALE.max);
    const yaw = rng() * Math.PI * 2;
    const solid = isSolidModel(id);
    if (solid && footprintKeepsClear(id, scale, x, z)) continue;
    placements.push({
      modelId: id, x, z, groundY: groundHeight, sink: 0, yaw, scale, layer: 'base', skyline: false,
      knockable: id === 'wild_rooibos_bush', solid, rock: boulderRock(id, x, z),
    });
  }

  // Boulders heaped along the border slope break up its long even face and skyline.
  const cliffRng = mulberry32(((cx * 83492791) ^ (cz * 2971215073) ^ seed ^ 0xc11f) >>> 0);
  for (let i = 0; i < CLIFF_ATTEMPTS; i++) {
    const x = ox + cliffRng() * CHUNK_SIZE;
    const z = oz + cliffRng() * CHUNK_SIZE;
    const faceDepth = W.borderFaceDepth(x, z);
    const band = faceDepth >= CLIFF_FOOT.from && faceDepth <= CLIFF_FOOT.to ? CLIFF_FOOT
      : faceDepth > CLIFF_FACE.from && faceDepth <= CLIFF_FACE.to ? CLIFF_FACE : null;
    if (!band || keepsClear(x, z)) continue;
    const scale = between(cliffRng, band.scaleMin, band.scaleMax);
    const id = anyBoulder(cliffRng);
    const yaw = cliffRng() * Math.PI * 2;
    const sink = SLOPE_SINK * scale;
    const colliderGround = terrainSurfaceHeight(height, x, z);
    const solid = faceDepth <= W.SOLID_FOOT_DEPTH;
    if (solid && footprintKeepsClear(id, scale, x, z)) continue;
    const ground = solid ? colliderGround : input.drawnHeight(colliderGround, x, z);
    placements.push({
      modelId: id, x, z, groundY: ground - sink, sink, yaw, scale, layer: 'border', skyline: band === CLIFF_FACE,
      knockable: false, solid, rock: boulderRock(id, x, z),
    });
  }

  const rockRng = mulberry32(((cx * 2654435761) ^ (cz * 40503) ^ seed ^ 0x60c4) >>> 0);
  const zoneCells = rockZoneCells(ox, oz);
  for (const zone of ROCK_ZONES) {
    const cells = zoneCells.get(zone);
    if (!cells) continue;
    for (const prop of rockZoneProps(zone, cells / (ZONE_GRID * ZONE_GRID), rockRng, ox, oz)) placements.push(rockPlacement(height, prop));
  }

  // The prototype's high tier adds a second, denser layer; here only bushes and stones, so the
  // tiers never disagree about what the car can hit.
  const extraRng = mulberry32(((cx * 19990303) ^ (cz * 83492791) ^ seed ^ 0xe7a) >>> 0);
  for (let i = 0; i < EXTRA_ATTEMPTS; i++) {
    const x = ox + extraRng() * CHUNK_SIZE;
    const z = oz + extraRng() * CHUNK_SIZE;
    if (keepsClear(x, z) || W.borderFaceDepth(x, z) > 0) continue;
    const { height: groundHeight, slope } = surfaceSampleAt(height, x, z);
    const cover = biome.coverAt(x, z, groundHeight, slope);
    if (cover !== 'sand' && cover !== 'dirt' && cover !== 'dryGrass') continue;
    const id: PolyPropId = extraRng() < 0.6 ? 'wild_rooibos_bush' : 'namaqualand_stones_01';
    const scale = between(extraRng, PROP_SCALE.min, PROP_SCALE.max);
    const yaw = extraRng() * Math.PI * 2;
    placements.push({
      modelId: id, x, z, groundY: groundHeight, sink: 0, yaw, scale, layer: 'highTier', skyline: false,
      knockable: id === 'wild_rooibos_bush', solid: false, rock: null,
    });
  }

  return placements;
}
