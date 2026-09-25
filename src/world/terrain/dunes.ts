// src/world/terrain/dunes.ts
// Wit Duine: rows of dunes, low and close in the west, high and far apart in the east, each with a
// gentle windward side and a slip face under WIT_DUINE.slipFaceMax (the Pajero can still climb it).
// Big Daddy stands over the rows; the J4 whoops cross a lower "nursery" at the west edge.
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../rng';
import { clamp, lerp, smoothstep } from '../blend';
import { NURSERY_WHOOPS, WIT_DUINE } from '../mapLayout';
import { WHOOPS_END_X, WHOOPS_START_X, whoopsProfile } from './crests';

const BOX = WIT_DUINE.area;
const WIDTH = BOX.maxX - BOX.minX;
const SPACING_GROWTH = (WIT_DUINE.spacing.east - WIT_DUINE.spacing.west) / WIDTH;
const PHASE_AT_EAST_EDGE = Math.log(WIT_DUINE.spacing.east / WIT_DUINE.spacing.west) / SPACING_GROWTH;

// Design §12.1 step 3: the rows bend with z and wander a little, so they never read as a grid.
const WARP = { amplitude: 45, frequency: 0.0055, noiseAmplitude: 30, noiseWavelength: 500 };
const AMPLITUDE_NOISE = { share: 0.3, wavelength: 300 };
const WINDWARD_EXPONENT = 1.3;
/** Share of a dune's length the slip face takes (design: brink at 0.66). */
const SLIP_SHARE = 0.34;
const AMPLITUDE_CAP_SMOOTHING = 3;
// A slip face alone stays this steep at most; the fading of the rows at the edges of the field,
// the amplitude noise and the plain's own slope add up to the last few hundredths of the cap.
const SLIP_SLOPE = WIT_DUINE.slipFaceMax - 0.1;
/**
 * Metres over which the rows fade in at each edge of the box. The tall rows (north, south, east)
 * fade over a long distance, so the fade adds little slope to a slip face (design feather: 80 m).
 */
const EDGE_FADE = { west: WIT_DUINE.feather, north: 200, south: 200, east: 200 };
const GRADIENT_STEP = 1;
/** The brink rounding never lowers a dune by more than this share of its height. */
const MAX_BRINK_SHARE = 0.4;

const warpNoise = createNoise2D(mulberry32(0xd00e01));
const amplitudeNoise = createNoise2D(mulberry32(0xd00e02));

function warpedX(x: number, z: number): number {
  return x + WARP.amplitude * Math.sin(WARP.frequency * z)
    + WARP.noiseAmplitude * warpNoise(x / WARP.noiseWavelength, z / WARP.noiseWavelength);
}

/** Spacing between rows at a warped x: west → east, 60 → 120 m (constant outside the box). */
function spacingAt(u: number): number {
  return WIT_DUINE.spacing.west + SPACING_GROWTH * clamp(u - BOX.minX, 0, WIDTH);
}

/** Number of rows from the west edge to a warped x; its rate of change is 1 / spacing. */
function phaseAt(u: number): number {
  if (u <= BOX.minX) return (u - BOX.minX) / WIT_DUINE.spacing.west;
  if (u >= BOX.maxX) return PHASE_AT_EAST_EDGE + (u - BOX.maxX) / WIT_DUINE.spacing.east;
  return Math.log(spacingAt(u) / WIT_DUINE.spacing.west) / SPACING_GROWTH;
}

// A product of smooth edges, so the fade has no crease along the box's diagonals.
function boxWeight(x: number, z: number): number {
  return smoothstep(BOX.minX, BOX.minX + EDGE_FADE.west, x) * (1 - smoothstep(BOX.maxX - EDGE_FADE.east, BOX.maxX, x))
    * smoothstep(BOX.minZ, BOX.minZ + EDGE_FADE.north, z) * (1 - smoothstep(BOX.maxZ - EDGE_FADE.south, BOX.maxZ, z));
}

function distanceOutsideLane(x: number, z: number): number {
  const lane = NURSERY_WHOOPS.lane;
  const dx = Math.max(WHOOPS_START_X - x, 0, x - WHOOPS_END_X);
  const dz = Math.max(lane.minZ - z, 0, z - lane.maxZ);
  return Math.hypot(dx, dz);
}

function amplitudeAt(x: number, z: number): number {
  const eastShare = clamp((x - BOX.minX) / WIDTH, 0, 1);
  const base = lerp(WIT_DUINE.amplitude.west, WIT_DUINE.amplitude.east, eastShare);
  const wander = 1 + AMPLITUDE_NOISE.share * amplitudeNoise(x / AMPLITUDE_NOISE.wavelength, z / AMPLITUDE_NOISE.wavelength);
  const nursery = 1 - NURSERY_WHOOPS.nurseryLowering * (1 - smoothstep(0, NURSERY_WHOOPS.nurseryReach, distanceOutsideLane(x, z)));
  return base * wander * boxWeight(x, z) * nursery;
}

function warpSlopeAt(x: number, z: number): number {
  return Math.hypot(
    warpedX(x + GRADIENT_STEP, z) - warpedX(x - GRADIENT_STEP, z),
    warpedX(x, z + GRADIENT_STEP) - warpedX(x, z - GRADIENT_STEP),
  ) / (2 * GRADIENT_STEP);
}

// Polynomial smooth minimum: rounds the brink where the windward side meets the slip face, and
// caps the amplitude without a crease.
function smoothMin(first: number, second: number, width: number): number {
  if (width <= 0) return Math.min(first, second);
  const share = Math.max(width - Math.abs(first - second), 0) / width;
  return Math.min(first, second) - (share * share * width) / 4;
}

/**
 * The rows' height at (x, z), never taller than a slip face of SLIP_SHARE can carry at SLIP_SLOPE.
 * The cap depends only on the spacing and the warp, which change over hundreds of metres.
 */
function cappedAmplitudeAt(x: number, z: number, u: number, warpSlope: number): number {
  const cap = (SLIP_SLOPE * SLIP_SHARE * spacingAt(u)) / warpSlope;
  return smoothMin(amplitudeAt(x, z), cap, AMPLITUDE_CAP_SMOOTHING);
}

function rowsHeight(x: number, z: number): number {
  const u = warpedX(x, z);
  const warpSlope = warpSlopeAt(x, z);
  const amplitude = cappedAmplitudeAt(x, z, u, warpSlope);
  if (amplitude <= 0) return 0;
  const spacing = spacingAt(u);
  const phase = phaseAt(u);
  const share = phase - Math.floor(phase);
  const brinkShare = 1 - SLIP_SHARE;

  const windward = amplitude * (share / brinkShare) ** WINDWARD_EXPONENT;
  const slip = amplitude * (1 - (share - brinkShare) / SLIP_SHARE);
  // Metric slopes at the brink, for a fillet of about brinkRadius metres.
  const metresPerShare = spacing / warpSlope;
  const windwardSlope = (WINDWARD_EXPONENT * amplitude) / (brinkShare * metresPerShare);
  const slipSlope = amplitude / (SLIP_SHARE * metresPerShare);
  const width = Math.min(MAX_BRINK_SHARE * amplitude, (WIT_DUINE.brinkRadius * (windwardSlope + slipSlope) ** 2) / 2);
  return Math.max(0, smoothMin(windward, slip, width));
}

function bigDaddyHeight(x: number, z: number): number {
  const { bigDaddy } = WIT_DUINE;
  const share = Math.hypot(x - bigDaddy.x, z - bigDaddy.z) / bigDaddy.radius;
  if (share >= 1) return 0;
  const falloff = 1 - share * share;
  return bigDaddy.height * falloff * falloff;
}

function laneWeight(x: number, z: number): number {
  const lane = NURSERY_WHOOPS.lane;
  const feather = NURSERY_WHOOPS.laneFeather;
  const alongZ = smoothstep(lane.minZ - feather, lane.minZ, z) * (1 - smoothstep(lane.maxZ, lane.maxZ + feather, z));
  const alongX = smoothstep(WHOOPS_START_X - feather, WHOOPS_START_X, x) * (1 - smoothstep(WHOOPS_END_X, WHOOPS_END_X + feather, x));
  return alongZ * alongX;
}

const REACH = WIT_DUINE.feather;

/** Metres the dunes raise the ground at (x, z); 0 outside the dune box. */
export function duneRise(x: number, z: number): number {
  if (x < BOX.minX - REACH || x > BOX.maxX || z < BOX.minZ || z > BOX.maxZ) return 0;
  const rows = Math.max(rowsHeight(x, z), bigDaddyHeight(x, z));
  const lane = laneWeight(x, z);
  return lane > 0 ? lerp(rows, whoopsProfile(x), lane) : rows;
}

/** True inside the dune field, where the ground is dune sand whatever its slope. */
export function inDuneField(x: number, z: number): boolean {
  if (x < BOX.minX || x > BOX.maxX || z < BOX.minZ || z > BOX.maxZ) return false;
  return boxWeight(x, z) > 0.25 || laneWeight(x, z) > 0.5;
}
