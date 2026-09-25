// src/assets/elantraPartRules.ts
// Pure rules for converting the Hyundai Elantra AD GLB into the game's flat node layout, and the
// assembly rules the renderer uses on the converted GLB. No three.js import at runtime, no DOM.
import type { CarAssemblyRules } from '../render/carModel';
import type { CarMaterialSlot, WheelSlot } from './carPartRules';

export interface ElantraVector {
  x: number;
  y: number;
  z: number;
}

/**
 * The source is in feet (its wheelbase reads 2.702 m, the real AD has 2.700 m), Y up, front +Z.
 * `origin` is the source point, in source units, that becomes the car-space origin: the centre
 * line, the ground under the tyres, and the middle of the body length.
 */
export const ELANTRA_SOURCE = {
  metresPerUnit: 0.3048,
  origin: { x: 3.575, y: -0.006, z: -7.6215 },
} as const;

/** Moves one point of the source's world space into car space (metres, Y up, front +Z). */
export function elantraCarSpacePoint(source: ElantraVector): ElantraVector {
  const scale = ELANTRA_SOURCE.metresPerUnit;
  return {
    x: (source.x - ELANTRA_SOURCE.origin.x) * scale,
    y: (source.y - ELANTRA_SOURCE.origin.y) * scale,
    z: (source.z - ELANTRA_SOURCE.origin.z) * scale,
  };
}

/** Every raw path starts below this node; the nodes above it are the SketchUp export wrapper. */
const SOURCE_MODEL_ROOT = 'skp603B';
/** SketchUp's Korean "component" group name, written out in ASCII so the keys stay readable. */
const SOURCE_COMPONENT_WORD = '\uAD6C\uC131 \uC694\uC18C';
/** The mirrored copy of a group repeats its name with this suffix. */
const MIRRORED_COPY_SUFFIX = '_1';
const NO_MATERIAL = '(none)';

/**
 * The stable key of one raw primitive: its node path below the model root, mirrored copies folded
 * onto their original, plus the raw material name. Node names alone repeat ("Geom3D").
 */
export function elantraRawKeyOf(pathFromScene: readonly string[], materialName: string | null): string {
  const rootIndex = pathFromScene.indexOf(SOURCE_MODEL_ROOT);
  if (rootIndex < 0) {
    throw new Error(`elantraRawKeyOf: the path "${pathFromScene.join('/')}" is not below "${SOURCE_MODEL_ROOT}"`);
  }
  const names = pathFromScene
    .slice(rootIndex + 1)
    .map((name) => name.split(SOURCE_COMPONENT_WORD).join('component'))
    .map((name) => (name.endsWith(MIRRORED_COPY_SUFFIX) ? name.slice(0, -MIRRORED_COPY_SUFFIX.length) : name));
  return `${names.join('/')}|${materialName ?? NO_MATERIAL}`;
}

export type ElantraDeletionReason = 'trunkBadge' | 'modelScript' | 'trimScript' | 'grilleBadge' | 'wheelCapBadge';

export type ElantraBodySlot =
  | 'paint'
  | 'glass'
  | 'clearGlass'
  | 'taillight'
  | 'indicator'
  | 'chrome'
  | 'blackTrim'
  | 'interior'
  | 'plate'
  | 'headlight';

const ELANTRA_BODY_SLOTS: readonly ElantraBodySlot[] = [
  'paint',
  'glass',
  'clearGlass',
  'taillight',
  'indicator',
  'chrome',
  'blackTrim',
  'interior',
  'plate',
  'headlight',
];

export type ElantraCornerPart = 'tyre' | 'rim' | 'rimDark';

export type ElantraTargetKey = ElantraBodySlot | ElantraCornerPart;

type ElantraRawRole =
  | { kind: 'deleted'; reason: ElantraDeletionReason }
  | { kind: 'body'; slot: ElantraBodySlot }
  | { kind: 'corner'; part: ElantraCornerPart };

const body = (slot: ElantraBodySlot): ElantraRawRole => ({ kind: 'body', slot });
const corner = (part: ElantraCornerPart): ElantraRawRole => ({ kind: 'corner', part });

/** Raw key -> role, for every primitive the source has (identified from renders of each key). */
export const ELANTRA_RAW_ROLES: Readonly<Record<string, ElantraRawRole>> = {
  // Inner body shell with the seats, dashboard and wheel-arch liners.
  'Dno/Geom3D_Dno|[Color B01]3': body('interior'),
  'YAYAT/Geom3D_YAYAT|[Color B01]3': body('blackTrim'),
  'chassis/Geom3D|[Color B04]1': body('paint'),
  // Window frames, seals, the pillars' black trim and the sunroof frame.
  'chassis/Geom3D_chassis|[Color B01]3': body('blackTrim'),
  'bonnet_ok/Geom3D|[Color B04]1': body('paint'),
  'bump_front/component#25/Geom3D|[Color B04]1': body('paint'),
  // Front-bumper fog-lamp LEDs.
  'bump_front/component#26/Geom3D|[Color A08]2': body('headlight'),
  'bump_front/component#26/Geom3D_component#26|[Color B01]3': body('blackTrim'),
  'bump_front/component#26/Geom3D|[Color B01]5': body('chrome'),
  'bump_front/component#26/Geom3D|[Color B01]3': body('blackTrim'),
  // Grille surround and bars; its "H" is removed by ELANTRA_BADGE_COMPONENTS, its bars move by ELANTRA_COMPONENT_SLOTS.
  'bump_front/component#26/Geom3D|[Color A05]': body('chrome'),
  'bump_front/component#26/Geom3D|[Color A08]3': body('blackTrim'),
  'SA7B/Geom3D_SA7B|(none)': body('blackTrim'),
  'bump_rear_/component#21/Geom3D|[Color B04]1': body('paint'),
  // Rear-bumper reflectors.
  'bump_rear_/component#22/Geom3D|[Color B04]': body('taillight'),
  'bump_rear_/component#22/Geom3D_component#22|[Color B01]3': body('blackTrim'),
  'bump_rear_/component#23/Geom3D_component#23|[Color B01]3': body('blackTrim'),
  'windscreen/component#16/Geom3D_component#16|[Color B07]': body('glass'),
  'windscreen/component#17/Geom3D_component#17|[Color B07]': body('glass'),
  'windscreen/component#18/Geom3D_component#18|[Color B07]': body('glass'),
  'component#1/component#13/Geom3D_component#13|[Color A05]': { kind: 'deleted', reason: 'modelScript' },
  'component#1/component#6/Geom3D|[Color A05]': { kind: 'deleted', reason: 'trunkBadge' },
  'component#1/component#11/Geom3D_component#11|[Color A05]': { kind: 'deleted', reason: 'trimScript' },
  'component#1/component#10/Geom3D_component#10|[Color B01]3': body('blackTrim'),
  'component#1/component#9/component#7/Geom3D_component#7|[Color B01]3': body('blackTrim'),
  'component#1/component#9/component#8/Geom3D_component#8|[Color B01]3': body('blackTrim'),
  'component#1/component#5/Geom3D|[Color B04]1': body('paint'),
  // Trunk-lid half of the tail lamps.
  'component#1/component#14/component#12/Geom3D|[Color B01]': body('taillight'),
  'component#1/component#14/component#12/Geom3D_component#12|[Color B04]': body('taillight'),
  'component#1/component#14/component#12/Geom3D|[Color C02]': body('headlight'),
  'component#1/component#14/component#12/Geom3D|[Color B01]1': body('taillight'),
  'component#1/component#14/Glass_BT/Geom3D|[Color B01]2': body('clearGlass'),
  // Red-tinted lens: drawn as clear glass it would wash the lamp out to pink.
  'component#1/component#14/Glass_BT/Geom3D|[Color A08]': body('taillight'),
  'component#1/component#14/Glass_BT/Geom3D|[Color B06]1': body('clearGlass'),
  'door_lf_ok/Geom3D|[Color B04]1': body('paint'),
  // Door cards, mirror bases and door seals.
  'door_lf_ok/Geom3D_door_lf_ok|[Color B01]3': body('blackTrim'),
  'door_lf_ok/Geom3D|[Color B07]': body('glass'),
  'door_lf_ok/Geom3D|[Color A05]': body('chrome'),
  'door_lr_ok/Geom3D|[Color B04]1': body('paint'),
  'door_lr_ok/Geom3D_door_lr_ok|[Color B01]3': body('blackTrim'),
  'door_lr_ok/Geom3D|[Color B07]': body('glass'),
  'door_lr_ok/Geom3D|[Color A05]': body('chrome'),
  'component#4/GlassFR/Geom3D|[Color B06]': body('clearGlass'),
  'component#4/LigtsFR/Geom3D_LigtsFR|[Color B06]2': body('blackTrim'),
  'component#4/LigtsFR/Geom3D|[Color A08]2': body('headlight'),
  'component#4/LigtsFR/Geom3D|[Color A08]1': body('chrome'),
  'component#4/LigtsFR/Geom3D|[Color B06]3': body('headlight'),
  // Clear cover over the amber corner lamp.
  'component#4/FR_R/Geom3D_FR_R|(none)': body('clearGlass'),
  'component#4/FR_R/Geom3D|[Color B01]4': body('indicator'),
  'component#15/GlassRR/Geom3D|[Color B06]1': body('clearGlass'),
  'component#15/GlassRR/Geom3D|[Color A08]': body('taillight'),
  'component#15/GlassRR/Geom3D|[Color B01]2': body('clearGlass'),
  'component#15/Light_RR/Geom3D|[Color C02]': body('headlight'),
  'component#15/Light_RR/Geom3D_Light_RR|[Color B04]': body('taillight'),
  'component#15/Light_RR/Geom3D|[Color B01]': body('taillight'),
  'component#15/Light_RR/Geom3D|[Color B01]1': body('taillight'),
  'component#27/wheel/component#28/Geom3D_component#28|[Color B01]3': corner('rimDark'),
  'component#27/wheel/component#28/Geom3D|[Color A05]': corner('rim'),
  'component#27/wheel/component#3/Geom3D_component#3|[Color B01]3': corner('tyre'),
};

/** Hub of the left wheels is at -x; the right wheels mirror it. Measured on the tyre bounds. */
export const ELANTRA_HUB = { x: 0.8035, y: 0.2851 } as const;
export const ELANTRA_WHEEL_Z = { front: 1.3988, rear: -1.3034 } as const;
/** A corner part centred further than this from its hub axis, or along it, is a part nobody has checked. */
const HUB_RADIAL_TOLERANCE = 0.02;
const HUB_AXIAL_TOLERANCE = 0.12;

export interface ElantraBox {
  min: ElantraVector;
  max: ElantraVector;
}

const GRILLE_BADGE_BOX: ElantraBox = { min: { x: -0.08, y: 0.5, z: 2.2 }, max: { x: 0.08, y: 0.585, z: 2.28 } };

/**
 * Badges that are one connected piece inside a larger raw part. `space: 'car'` boxes are in car
 * space; `space: 'hub'` boxes are around the part's hub, with x measured outward from the tyre
 * centre, so one box fits all four wheels. A component is removed only when it lies fully inside.
 */
export const ELANTRA_BADGE_COMPONENTS: Readonly<
  Record<string, { reason: ElantraDeletionReason; space: 'car' | 'hub'; box: ElantraBox }>
> = {
  'bump_front/component#26/Geom3D|[Color A05]': { reason: 'grilleBadge', space: 'car', box: GRILLE_BADGE_BOX },
  // The dark ring and letter behind the chrome "H"; left alone they still read as the logo.
  'bump_front/component#26/Geom3D_component#26|[Color B01]3': { reason: 'grilleBadge', space: 'car', box: GRILLE_BADGE_BOX },
  // The "H" sits on the centre cap, which starts 7 cm out from the tyre centre; the logo starts at 8.
  'component#27/wheel/component#28/Geom3D_component#28|[Color B01]3': {
    reason: 'wheelCapBadge',
    space: 'hub',
    box: { min: { x: 0.08, y: -0.03, z: -0.03 }, max: { x: 0.1, y: 0.03, z: 0.03 } },
  },
};

// Holds the seven horizontal bars and not the hexagonal surround, which is wider and taller.
const GRILLE_BARS_BOX: ElantraBox = { min: { x: -0.5, y: 0.27, z: 2.13 }, max: { x: 0.5, y: 0.56, z: 2.285 } };

/**
 * Pieces of a raw part that take another body slot: a connected component that lies fully inside
 * `box` (car space) goes to `slot`. On the real AD the grille bars are gloss black and only the
 * surround is chrome, but the source puts both in one chrome part.
 */
export const ELANTRA_COMPONENT_SLOTS: Readonly<Record<string, { box: ElantraBox; slot: ElantraBodySlot }>> = {
  'bump_front/component#26/Geom3D|[Color A05]': { box: GRILLE_BARS_BOX, slot: 'blackTrim' },
};

/** The body slot one connected component of a raw part moves to; null keeps the part's own slot. */
export function elantraComponentSlotOf(rawKey: string, component: ElantraBox): ElantraBodySlot | null {
  const rule = ELANTRA_COMPONENT_SLOTS[rawKey];
  if (!rule) return null;
  return isInside(rule.box, component) ? rule.slot : null;
}

export const ELANTRA_TRIANGLE_TARGETS: Readonly<Record<ElantraTargetKey, number>> = {
  // Kept whole: the source paint is already low on the rear bumper, and the clearcoat shows every facet.
  paint: 45000,
  blackTrim: 22000,
  taillight: 9000,
  headlight: 8000,
  chrome: 7000,
  interior: 5000,
  clearGlass: 4000,
  glass: 1400,
  indicator: 1000,
  plate: 2,
  tyre: 1400,
  rimDark: 3500,
  rim: 1300,
};

/**
 * The blank rear plate. The source has none; it sits on the trunk lid's lower panel between the
 * (removed) scripts, 1 cm off the surface. The panel leans forward by atan(0.338) (plane fit).
 */
export const ELANTRA_PLATE = {
  width: 0.335,
  height: 0.17,
  centre: { x: 0, y: 0.69, z: -2.2083 },
  leanRadians: Math.atan(0.3381),
} as const;

/** Two triangles facing backward and up, wound counter-clockwise as seen from behind the car. */
export function elantraPlateQuad(): { positions: Float32Array; indices: Uint32Array } {
  const { width, height, centre, leanRadians } = ELANTRA_PLATE;
  const upY = Math.cos(leanRadians);
  const upZ = Math.sin(leanRadians);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const cornerAt = (side: number, rise: number): number[] => [
    centre.x + side * halfWidth,
    centre.y + rise * halfHeight * upY,
    centre.z + rise * halfHeight * upZ,
  ];
  // Seen from behind (looking along +z), +x is on the viewer's left.
  const bottomLeft = cornerAt(1, -1);
  const bottomRight = cornerAt(-1, -1);
  const topRight = cornerAt(-1, 1);
  const topLeft = cornerAt(1, 1);
  return {
    positions: new Float32Array([...bottomLeft, ...bottomRight, ...topRight, ...topLeft]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

/** One raw primitive, measured in car space. */
export interface ElantraPartSample {
  rawKey: string;
  centre: ElantraVector;
  size: ElantraVector;
}

export type ElantraPartClass =
  | { kind: 'deleted'; reason: ElantraDeletionReason }
  | {
      kind: 'part';
      cleanId: string;
      slot: CarMaterialSlot;
      targetKey: ElantraTargetKey;
      /** Where the part's vertices are centred and its node is placed; null keeps car space. */
      hub: ElantraVector | null;
    };

const CORNER_PART_SLOTS: Readonly<Record<ElantraCornerPart, CarMaterialSlot>> = {
  tyre: 'rubber',
  rim: 'rim',
  rimDark: 'rimDark',
};

const WHEEL_SLOTS: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const CORNER_PARTS: readonly ElantraCornerPart[] = ['tyre', 'rim', 'rimDark'];

const CORNER_LETTERS: Readonly<Record<WheelSlot, string>> = {
  wheelFL: 'FL',
  wheelFR: 'FR',
  wheelRL: 'RL',
  wheelRR: 'RR',
};

function cornerPartId(wheel: WheelSlot, part: ElantraCornerPart): string {
  const letters = CORNER_LETTERS[wheel];
  switch (part) {
    case 'tyre':
      return `wheel${letters}`;
    case 'rim':
      return `wheel${letters}Rim`;
    case 'rimDark':
      return `wheel${letters}RimDark`;
  }
}

const CORNER_PART_BY_ID: ReadonlyMap<string, { wheel: WheelSlot; part: ElantraCornerPart }> = new Map(
  WHEEL_SLOTS.flatMap((wheel) => CORNER_PARTS.map((part) => [cornerPartId(wheel, part), { wheel, part }] as const)),
);

function isElantraBodySlot(nodeId: string): nodeId is ElantraBodySlot {
  return ELANTRA_BODY_SLOTS.some((slot) => slot === nodeId);
}

/** The hub a corner part belongs to. The game rig puts its left wheels at negative X. */
export function elantraHubOf(centre: ElantraVector): { wheel: WheelSlot; hub: ElantraVector } {
  const isFront = centre.z > 0;
  const isLeft = centre.x < 0;
  const hub = {
    x: isLeft ? -ELANTRA_HUB.x : ELANTRA_HUB.x,
    y: ELANTRA_HUB.y,
    z: isFront ? ELANTRA_WHEEL_Z.front : ELANTRA_WHEEL_Z.rear,
  };
  const radialDistance = Math.hypot(centre.y - hub.y, centre.z - hub.z);
  const axialDistance = Math.abs(centre.x - hub.x);
  if (radialDistance > HUB_RADIAL_TOLERANCE || axialDistance > HUB_AXIAL_TOLERANCE) {
    throw new Error(
      `elantraHubOf: a wheel part centred at (${centre.x.toFixed(3)}, ${centre.y.toFixed(3)}, ${centre.z.toFixed(3)}) is ${radialDistance.toFixed(3)} m off the nearest hub axis and ${axialDistance.toFixed(3)} m along it`,
    );
  }
  const wheel: WheelSlot = isFront ? (isLeft ? 'wheelFL' : 'wheelFR') : isLeft ? 'wheelRL' : 'wheelRR';
  return { wheel, hub };
}

/** Decides what the converter does with one raw primitive: delete it, or which clean id it joins. */
export function classifyElantraPart(sample: ElantraPartSample): ElantraPartClass {
  const role = ELANTRA_RAW_ROLES[sample.rawKey];
  if (!role) throw new Error(`classifyElantraPart: no role for raw key "${sample.rawKey}"`);
  switch (role.kind) {
    case 'deleted':
      return { kind: 'deleted', reason: role.reason };
    case 'body':
      return { kind: 'part', cleanId: role.slot, slot: role.slot, targetKey: role.slot, hub: null };
    case 'corner': {
      const { wheel, hub } = elantraHubOf(sample.centre);
      return { kind: 'part', cleanId: cornerPartId(wheel, role.part), slot: CORNER_PART_SLOTS[role.part], targetKey: role.part, hub };
    }
  }
}

function isInside(box: ElantraBox, component: ElantraBox): boolean {
  return (
    component.min.x >= box.min.x &&
    component.min.y >= box.min.y &&
    component.min.z >= box.min.z &&
    component.max.x <= box.max.x &&
    component.max.y <= box.max.y &&
    component.max.z <= box.max.z
  );
}

/**
 * Whether one connected component of a raw part is a badge. `component` is in car space; `hub`
 * is the part's hub (from classifyElantraPart) and is required for a hub-space rule.
 */
export function elantraBadgeReasonOf(
  rawKey: string,
  component: ElantraBox,
  hub: ElantraVector | null,
): ElantraDeletionReason | null {
  const rule = ELANTRA_BADGE_COMPONENTS[rawKey];
  if (!rule) return null;
  if (rule.space === 'car') return isInside(rule.box, component) ? rule.reason : null;
  if (!hub) throw new Error(`elantraBadgeReasonOf: the rule for "${rawKey}" needs the part's hub`);
  // Outward is -x on the left wheels, so mirror them before the x test.
  const outward = hub.x < 0 ? -1 : 1;
  const firstX = (component.min.x - hub.x) * outward;
  const secondX = (component.max.x - hub.x) * outward;
  const local: ElantraBox = {
    min: { x: Math.min(firstX, secondX), y: component.min.y - hub.y, z: component.min.z - hub.z },
    max: { x: Math.max(firstX, secondX), y: component.max.y - hub.y, z: component.max.z - hub.z },
  };
  return isInside(rule.box, local) ? rule.reason : null;
}

/** Material slot for a clean node id of the converted GLB. Throws on an unknown id (no default slot). */
export function elantraMaterialSlotFor(nodeId: string): CarMaterialSlot {
  if (isElantraBodySlot(nodeId)) return nodeId;
  const cornerPart = CORNER_PART_BY_ID.get(nodeId);
  if (!cornerPart) throw new Error(`elantraMaterialSlotFor: no material slot documented for node id "${nodeId}"`);
  return CORNER_PART_SLOTS[cornerPart.part];
}

function cornerPartOrBody(nodeId: string): { wheel: WheelSlot; part: ElantraCornerPart } | null {
  const cornerPart = CORNER_PART_BY_ID.get(nodeId);
  if (cornerPart) return cornerPart;
  if (isElantraBodySlot(nodeId)) return null;
  throw new Error(`ELANTRA_ASSEMBLY_RULES: unknown node id "${nodeId}"`);
}

export const ELANTRA_ASSEMBLY_RULES: CarAssemblyRules = {
  wheelCornerOf(nodeId) {
    return cornerPartOrBody(nodeId)?.wheel ?? null;
  },
  spinsWithWheel(nodeId) {
    // The source has no brake discs or calipers, so every corner part rolls with the wheel.
    return cornerPartOrBody(nodeId) !== null;
  },
  slotFor: elantraMaterialSlotFor,
  tyreNodeIdOf(slot) {
    return cornerPartId(slot, 'tyre');
  },
  needsCylindricalUv(nodeId) {
    // The source tyre has no maps, so it takes the generated tread like the Pajero's.
    return cornerPartOrBody(nodeId)?.part === 'tyre';
  },
};

/** Measured on the converted GLB and printed by scripts/convert-elantra.ts. */
export const measuredCarElantra = {
  wheelbase: 2.7022,
  track: 1.607,
  tyreRadius: 0.2852,
  tyreWidth: 0.1861,
  wheelCentreY: 0.2851,
  archTopY: 0.6087,
  length: 4.5537,
} as const;
