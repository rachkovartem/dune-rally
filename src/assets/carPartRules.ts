// src/assets/carPartRules.ts
// Pure rules for converting the raw Pajero Sport FBX into the game's car rig: glass vs. paint,
// wheel corner, node id -> material slot, rim vs. tyre. Used by scripts/convert-car.ts (Node)
// and by the renderer at load time; no three.js import, no DOM.

export type CarMaterialSlot =
  | 'paint'
  | 'glass'
  | 'chrome'
  | 'rubber'
  | 'rim'
  | 'headlight'
  | 'taillight'
  | 'interior'
  | 'blackTrim';

export type WheelSlot = 'wheelFL' | 'wheelFR' | 'wheelRL' | 'wheelRR';

/** Two unfiltered simplify passes (see convert-car.ts step 4) compound to ~5% of raw tris despite
 * the 0.10/0.50 labels: gltf-transform 4.5.0's `simplify()` ignores a `filter` and re-runs over
 * every primitive each call. This reproduces the tech lead's own measured, checked ~83k result. */
export const SIMPLIFY = { wheelRatio: 0.10, bodyRatio: 0.50, error: 0.01 } as const;

/** Raw FBX2glTF name -> clean id, for non-wheel nodes (wheels are matched by translation via
 * wheelSlotFor, since FBX2glTF's Rim/.001/.002/.003 order does not match FL/FR/RL/RR). Identified
 * from bounds + renders (scratchpad probe raw-front/rear/side/inside.png, 2026-09-24). */
export const CAR_NODE_RENAMES: Record<string, string> = {
  'vent inner': 'bodyShell',        // roof + windscreen + rear glass, split below
  'vent inner.013': 'doorFront',    // both front doors incl. windows, split below
  'vent inner.014': 'doorRear',     // both rear doors incl. windows, split below
  'vent inner.012': 'hood',
  'vent inner.009': 'tailgate',     // incl. rear window, split below
  'vent inner.008': 'bumperRear',
  'vent inner.004': 'underbody',
  'vent inner.003': 'runningBoards',
  'vent inner.006': 'grilleLower',
  'vent inner.007': 'skidPlate',
  'vent inner.010': 'plateHolder',
  'vent inner.001': 'interiorA',
  'vent inner.002': 'interiorB',
  'vent inner.011': 'interiorC',
  'vent inner.015': 'interiorD',
  'Grill': 'grille',
  'Front vent': 'frontVent',
  'Body.001': 'grilleAccent',
  'Front Lamp': 'headlight',
  'Rear Lamp': 'taillight',
  'kacaspion': 'mirrorHousing',
  'kacaspion2': 'mirrorGlass',
};

/** Raw nodes dropped entirely: the camera rig, and the manufacturer badge (spec: unbranded). */
export const NODES_TO_DELETE = ['Camera', 'Plane'] as const;

/** Clean body ids that get split into a paint primitive and a `<id>Glass` glass primitive. */
export const GLASS_SPLIT_NODES = ['bodyShell', 'doorFront', 'doorRear', 'tailgate'] as const;

const ROOF_LINE_Y = 1.0;
const GLASS_NORMAL_Y_MAX = 0.6;
const BELT_FRONT = 0.74;
const BELT_REAR = 0.86;
const BELT_REAR_Z_MAX = -2.5;

export interface CarTriangleSample {
  /** Triangle centroid Y, world space, after the node's own transform is applied. */
  centroidY: number;
  /** Triangle centroid Z, world space. */
  centroidZ: number;
  /** Triangle face normal Y component. */
  normalY: number;
}

/** Belt line height at a given Z: higher at the rear (tailgate glass sits higher than the doors'). */
function beltLineAt(centroidZ: number): number {
  return centroidZ < BELT_REAR_Z_MAX ? BELT_REAR : BELT_FRONT;
}

/** Glass vs. paint for one triangle of a GLASS_SPLIT_NODES mesh, checked against the raw model
 * (scratchpad probe glass-front/side/rear.png): side windows and rear glass read as glass; the
 * windscreen/roof need the roof-line escape hatch because their normal is steep like a window's. */
export function classifyCarTriangle({ centroidY, centroidZ, normalY }: CarTriangleSample): 'glass' | 'paint' {
  const belt = beltLineAt(centroidZ);
  if (!(centroidY > belt)) return 'paint';
  if (centroidY < ROOF_LINE_Y) return 'glass';
  return Math.abs(normalY) < GLASS_NORMAL_Y_MAX ? 'glass' : 'paint';
}

/** Front/rear boundary for wheel translations: front wheels sit at z ≈ −0.487, rear at z ≈ −2.172
 * (front = the larger/less-negative z) on the raw model. The boundary is the midpoint, so either
 * measured wheel falls unambiguously on its own side. */
export const WHEEL_FRONT_REAR_BOUNDARY_Z = -1.33;

/** Maps a wheel node's translation to its rig slot, matching `cfg.wheel.positions` order (FL, FR, RL, RR). */
export function wheelSlotFor(translation: { x: number; z: number }): WheelSlot {
  if (translation.x === 0) {
    throw new Error(`wheelSlotFor: translation.x is 0 (z=${translation.z}) — cannot tell left from right`);
  }
  const isLeft = translation.x < 0;
  const isFront = translation.z > WHEEL_FRONT_REAR_BOUNDARY_Z;
  if (isFront) return isLeft ? 'wheelFL' : 'wheelFR';
  return isLeft ? 'wheelRL' : 'wheelRR';
}

/** Ratio of tyre radius below which a wheel vertex belongs to the rim, not the rubber. */
export const WHEEL_RIM_RADIUS_RATIO = 0.62;

/** Rim vs. rubber for one vertex of a wheel mesh, by its distance from the wheel's spin axis. */
export function classifyWheelVertex(radialDistance: number, tyreRadius: number): 'rim' | 'rubber' {
  return radialDistance < tyreRadius * WHEEL_RIM_RADIUS_RATIO ? 'rim' : 'rubber';
}

/** Clean node id -> material slot. Every id the conversion pipeline can produce must be listed. */
const CAR_MATERIAL_SLOTS: Record<string, CarMaterialSlot> = {
  bodyShell: 'paint',
  bodyShellGlass: 'glass',
  doorFront: 'paint',
  doorFrontGlass: 'glass',
  doorRear: 'paint',
  doorRearGlass: 'glass',
  hood: 'paint',
  tailgate: 'paint',
  tailgateGlass: 'glass',
  bumperRear: 'paint',
  underbody: 'blackTrim',
  runningBoards: 'chrome',
  grilleLower: 'blackTrim',
  skidPlate: 'chrome',
  plateHolder: 'blackTrim',
  interiorA: 'interior',
  interiorB: 'interior',
  interiorC: 'interior',
  interiorD: 'interior',
  grille: 'blackTrim',
  frontVent: 'blackTrim',
  grilleAccent: 'chrome',
  headlight: 'headlight',
  taillight: 'taillight',
  mirrorHousing: 'paint',
  mirrorGlass: 'chrome',
  wheelFL: 'rubber',
  wheelFR: 'rubber',
  wheelRL: 'rubber',
  wheelRR: 'rubber',
  wheelFLRim: 'rim',
  wheelFRRim: 'rim',
  wheelRLRim: 'rim',
  wheelRRRim: 'rim',
};

/** Material slot for a clean node id. Throws on an unknown id — no default slot, ever (rule 14). */
export function materialSlotFor(nodeId: string): CarMaterialSlot {
  const slot = CAR_MATERIAL_SLOTS[nodeId];
  if (!slot) throw new Error(`materialSlotFor: no material slot documented for node id "${nodeId}"`);
  return slot;
}

/** Measured on the actual converted GLB, not copied from the feasibility probe: wheel node
 * translations and bodyShell/wheel vertex bounds, printed by convert-car.ts's own
 * `printMeasuredCar` step. `archTopY` is the lowest bodyShell point above the front wheel hub. */
export const measuredCar = {
  wheelbase: 1.6855,
  track: 0.9251,
  tyreRadius: 0.2335,
  tyreWidth: 0.156,
  wheelCentreY: 0.2316,
  archTopY: 0.5007,
  length: 2.8521,
} as const;
