// src/assets/foresterPartRules.ts
// Pure rules for converting the Subaru Forester 2019 FBX into the game's flat node layout, and the
// assembly rules the renderer uses on the converted GLB. Used by scripts/convert-forester.ts
// (Node) and at load time; no three.js import at runtime, no DOM.
import type { CarAssemblyRules } from '../render/carModel';
import type { CarMaterialSlot, WheelSlot } from './carPartRules';

export type ForesterDeletionReason = 'badge' | 'wheelCapBadge' | 'blueMaterial';

/** Raw nodes that are removed: manufacturer badges and the badges on the wheel caps (spec: unbranded). */
export const FORESTER_DELETED_NODES: Readonly<Record<string, ForesterDeletionReason>> = {
  'desirefx.me_184': 'badge',
  'desirefx.me_189': 'badge',
  'desirefx.me_191': 'badge',
  'desirefx.me_192': 'badge',
  'desirefx.me_013': 'badge',
  'desirefx.me_014': 'badge',
  'desirefx.me_007': 'badge',
  'desirefx.me_179': 'badge',
  'desirefx.me_183': 'wheelCapBadge',
  'desirefx.me_188': 'wheelCapBadge',
  'desirefx.me_195': 'wheelCapBadge',
  'desirefx.me_198': 'wheelCapBadge',
  'desirefx.me_069': 'wheelCapBadge',
  'desirefx.me_072': 'wheelCapBadge',
  'desirefx.me_127': 'wheelCapBadge',
  'desirefx.me_136': 'wheelCapBadge',
};

/** Every node with this raw material is the blue brand oval, wherever it sits. */
const DELETED_MATERIAL = 'blue';

/** The exhaust tip carries a non-chrome material in the source but reads as chrome. */
const EXHAUST_NODE = 'desirefx.me_048';

export type ForesterBodySlot =
  | 'paint'
  | 'glass'
  | 'clearGlass'
  | 'taillight'
  | 'indicator'
  | 'chrome'
  | 'silver'
  | 'blackTrim'
  | 'interior'
  | 'plate'
  | 'headlight';

const FORESTER_BODY_SLOTS: readonly ForesterBodySlot[] = [
  'paint',
  'glass',
  'clearGlass',
  'taillight',
  'indicator',
  'chrome',
  'silver',
  'blackTrim',
  'interior',
  'plate',
  'headlight',
];

/** Raw material name -> slot for body nodes. The tyre and brake materials are missing on purpose:
 * outside a wheel corner they would be a part nobody has checked, so they throw. */
export const FORESTER_MATERIAL_SLOTS: Readonly<Record<string, ForesterBodySlot>> = {
  body: 'paint',
  d_glass: 'glass',
  vd_glass: 'glass',
  glass: 'clearGlass',
  r_glass: 'taillight',
  red: 'taillight',
  d_red: 'taillight',
  o_glass: 'indicator',
  orange: 'indicator',
  chrome: 'chrome',
  silver: 'silver',
  silver_d: 'silver',
  black: 'blackTrim',
  black_m: 'blackTrim',
  gum: 'blackTrim',
  interior: 'interior',
  plate: 'plate',
};

export type ForesterCornerPart = 'tyre' | 'rimDark' | 'rim' | 'caliper' | 'brake';

export type ForesterTargetKey = ForesterBodySlot | ForesterCornerPart;

/** Triangle budget per clean id after simplification; corner parts are per corner. */
export const FORESTER_TRIANGLE_TARGETS: Readonly<Record<ForesterTargetKey, number>> = {
  paint: 28000,
  blackTrim: 18000,
  chrome: 9000,
  interior: 6000,
  taillight: 6000,
  glass: 6000,
  clearGlass: 5000,
  silver: 5000,
  headlight: 4000,
  indicator: 1500,
  plate: 24,
  tyre: 3000,
  rimDark: 3500,
  rim: 1500,
  caliper: 900,
  brake: 600,
};

export const FORESTER_WHEEL_Z = { front: 1.345, rear: -1.315 } as const;
export const FORESTER_HUB = { x: 0.782, y: 0.355 } as const;

const CORNER_X_MIN = 0.7;
const CORNER_X_MAX = 0.95;
const CORNER_Z_TOLERANCE = 0.2;
const CORNER_Y_MIN = 0.1;
const CORNER_Y_MAX = 0.6;
const CORNER_SIZE_MAX = 0.75;
const HEADLIGHT_REFLECTOR_Z = 1.921;
const HEADLIGHT_REFLECTOR_Z_TOLERANCE = 0.05;
const HEADLIGHT_REFLECTOR_MIN_WIDTH = 1.6;

export interface ForesterVector {
  x: number;
  y: number;
  z: number;
}

/** One raw node, measured in car space (Y up, front +Z) after its world matrix is applied. */
export interface ForesterNodeSample {
  rawName: string;
  materialName: string;
  centre: ForesterVector;
  size: ForesterVector;
}

export type ForesterNodeClass =
  | { kind: 'deleted'; reason: ForesterDeletionReason }
  | {
      kind: 'part';
      cleanId: string;
      slot: CarMaterialSlot;
      targetKey: ForesterTargetKey;
      /** Where the part's vertices are centred and its node is placed; null keeps car space. */
      hub: ForesterVector | null;
    };

const CORNER_PART_SLOTS: Readonly<Record<ForesterCornerPart, CarMaterialSlot>> = {
  tyre: 'rubber',
  rimDark: 'rimDark',
  rim: 'rim',
  brake: 'brake',
  // The source calipers mix gum and silver parts; joined into one primitive they take one slot.
  caliper: 'blackTrim',
};

const WHEEL_SLOTS: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

const CORNER_LETTERS: Readonly<Record<WheelSlot, string>> = {
  wheelFL: 'FL',
  wheelFR: 'FR',
  wheelRL: 'RL',
  wheelRR: 'RR',
};

function cornerPartId(corner: WheelSlot, part: ForesterCornerPart): string {
  const letters = CORNER_LETTERS[corner];
  switch (part) {
    case 'tyre':
      return `wheel${letters}`;
    case 'rim':
      return `wheel${letters}Rim`;
    case 'rimDark':
      return `wheel${letters}RimDark`;
    case 'brake':
      return `brake${letters}`;
    case 'caliper':
      return `caliper${letters}`;
  }
}

const CORNER_PARTS: readonly ForesterCornerPart[] = ['tyre', 'rim', 'rimDark', 'brake', 'caliper'];

const CORNER_PART_BY_ID: ReadonlyMap<string, { corner: WheelSlot; part: ForesterCornerPart }> = new Map(
  WHEEL_SLOTS.flatMap((corner) => CORNER_PARTS.map((part) => [cornerPartId(corner, part), { corner, part }] as const)),
);

function isForesterBodySlot(nodeId: string): nodeId is ForesterBodySlot {
  return FORESTER_BODY_SLOTS.some((slot) => slot === nodeId);
}

function cornerOf(centre: ForesterVector): WheelSlot {
  const isFront = Math.abs(centre.z - FORESTER_WHEEL_Z.front) < CORNER_Z_TOLERANCE;
  // The game rig puts its left wheels at negative X (vehicleConfig wheel.positions), so a part
  // must be named after the rig pivot on its own side or it is mounted mirrored.
  const isLeft = centre.x < 0;
  if (isFront) return isLeft ? 'wheelFL' : 'wheelFR';
  return isLeft ? 'wheelRL' : 'wheelRR';
}

function isCornerPart(centre: ForesterVector, largestSize: number): boolean {
  const sideDistance = Math.abs(centre.x);
  const nearFront = Math.abs(centre.z - FORESTER_WHEEL_Z.front) < CORNER_Z_TOLERANCE;
  const nearRear = Math.abs(centre.z - FORESTER_WHEEL_Z.rear) < CORNER_Z_TOLERANCE;
  return (
    sideDistance > CORNER_X_MIN &&
    sideDistance < CORNER_X_MAX &&
    (nearFront || nearRear) &&
    centre.y > CORNER_Y_MIN &&
    centre.y < CORNER_Y_MAX &&
    largestSize < CORNER_SIZE_MAX
  );
}

function cornerPartFor(materialName: string, largestSize: number): ForesterCornerPart {
  if (materialName === 'tire_mat4') return 'tyre';
  if (materialName === 'black_m') return 'rimDark';
  if (materialName === 'brakes1') return 'brake';
  const isRimPiece =
    materialName === 'silver' ||
    (materialName === 'silver_d' && largestSize < 0.15) ||
    (materialName === 'gum' && largestSize < 0.05) ||
    (materialName === 'black' && largestSize < 0.05);
  return isRimPiece ? 'rim' : 'caliper';
}

function bodyPart(slot: ForesterBodySlot): ForesterNodeClass {
  return { kind: 'part', cleanId: slot, slot, targetKey: slot, hub: null };
}

/** Decides what the converter does with one raw node: delete it, or which clean id it joins. */
export function classifyForesterNode(sample: ForesterNodeSample): ForesterNodeClass {
  const deletionReason = FORESTER_DELETED_NODES[sample.rawName];
  if (deletionReason) return { kind: 'deleted', reason: deletionReason };
  if (sample.materialName === DELETED_MATERIAL) return { kind: 'deleted', reason: 'blueMaterial' };

  const largestSize = Math.max(sample.size.x, sample.size.y, sample.size.z);
  if (isCornerPart(sample.centre, largestSize)) {
    const corner = cornerOf(sample.centre);
    const part = cornerPartFor(sample.materialName, largestSize);
    const spins = part === 'tyre' || part === 'rim' || part === 'rimDark';
    const isFront = corner === 'wheelFL' || corner === 'wheelFR';
    const hub = spins
      ? {
          x: Math.sign(sample.centre.x) * FORESTER_HUB.x,
          y: FORESTER_HUB.y,
          z: isFront ? FORESTER_WHEEL_Z.front : FORESTER_WHEEL_Z.rear,
        }
      : null;
    return { kind: 'part', cleanId: cornerPartId(corner, part), slot: CORNER_PART_SLOTS[part], targetKey: part, hub };
  }

  if (sample.rawName === EXHAUST_NODE) return bodyPart('chrome');
  if (
    sample.materialName === 'chrome' &&
    Math.abs(sample.centre.z - HEADLIGHT_REFLECTOR_Z) < HEADLIGHT_REFLECTOR_Z_TOLERANCE &&
    sample.size.x > HEADLIGHT_REFLECTOR_MIN_WIDTH
  ) {
    return bodyPart('headlight');
  }

  const slot = FORESTER_MATERIAL_SLOTS[sample.materialName];
  if (!slot) {
    throw new Error(
      `classifyForesterNode: no slot for material "${sample.materialName}" (raw node "${sample.rawName}")`,
    );
  }
  return bodyPart(slot);
}

/** Material slot for a clean node id of the converted GLB. Throws on an unknown id (no default slot). */
export function foresterMaterialSlotFor(nodeId: string): CarMaterialSlot {
  if (isForesterBodySlot(nodeId)) return nodeId;
  const cornerPart = CORNER_PART_BY_ID.get(nodeId);
  if (!cornerPart) throw new Error(`foresterMaterialSlotFor: no material slot documented for node id "${nodeId}"`);
  return CORNER_PART_SLOTS[cornerPart.part];
}

function cornerPartOrBody(nodeId: string): { corner: WheelSlot; part: ForesterCornerPart } | null {
  const cornerPart = CORNER_PART_BY_ID.get(nodeId);
  if (cornerPart) return cornerPart;
  if (isForesterBodySlot(nodeId)) return null;
  throw new Error(`FORESTER_ASSEMBLY_RULES: unknown node id "${nodeId}"`);
}

export const FORESTER_ASSEMBLY_RULES: CarAssemblyRules = {
  wheelCornerOf(nodeId) {
    return cornerPartOrBody(nodeId)?.corner ?? null;
  },
  spinsWithWheel(nodeId) {
    const cornerPart = cornerPartOrBody(nodeId);
    if (!cornerPart) return false;
    return cornerPart.part === 'tyre' || cornerPart.part === 'rim' || cornerPart.part === 'rimDark';
  },
  slotFor: foresterMaterialSlotFor,
  tyreNodeIdOf(slot) {
    return cornerPartId(slot, 'tyre');
  },
  needsCylindricalUv(nodeId) {
    // The tyre ships its own UV for the embedded tread and sidewall maps.
    cornerPartOrBody(nodeId);
    return false;
  },
};

/** Measured on the converted GLB and printed by scripts/convert-forester.ts. */
export const measuredCarForester = {
  wheelbase: 2.66,
  track: 1.564,
  tyreRadius: 0.3555,
  tyreWidth: 0.2476,
  wheelCentreY: 0.355,
  archTopY: 0.7864,
  length: 4.6247,
} as const;
