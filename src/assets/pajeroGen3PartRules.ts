// src/assets/pajeroGen3PartRules.ts
// Pure rules for converting the Mitsubishi Pajero Sport gen 3 facelift GLB into the game's flat node
// layout, and the assembly rules the renderer uses on the converted GLB. No three.js import at
// runtime, no DOM.
import type { CarAssemblyRules } from '../render/carModel';
import type { CarMaterialSlot, WheelSlot } from './carPartRules';

export interface PajeroVector {
  x: number;
  y: number;
  z: number;
}

/**
 * The source is Y up with the nose at +Z, but about 9 % too large: its wheelbase reads 3.060 against
 * the real 2.800 m, and its length 5.28 against 4.825 m, so it is scaled to the real wheelbase.
 * `origin` is the source point that becomes the car-space origin: the centre line, the ground under
 * the tyres, and the middle of the body length.
 */
export const PAJERO_SOURCE = {
  scale: 2.8 / 3.06,
  origin: { x: 5.6525, y: 0.0085, z: -12.17765 },
} as const;

/** Moves one point of the source's world space into car space (metres, Y up, front +Z). */
export function pajeroCarSpacePoint(source: PajeroVector): PajeroVector {
  const scale = PAJERO_SOURCE.scale;
  return {
    x: (source.x - PAJERO_SOURCE.origin.x) * scale,
    y: (source.y - PAJERO_SOURCE.origin.y) * scale,
    z: (source.z - PAJERO_SOURCE.origin.z) * scale,
  };
}

/** Short names for the two long wrapper nodes, so the keys stay readable. */
const SOURCE_NAME_ALIASES: Readonly<Record<string, string>> = {
  'mitsubishi+pajero+sport+2016#1': 'car',
  'mitsubishi+pajero+sport+2016': 'body',
};
/** The mirrored and repeated copies of a group repeat its name with this suffix. */
const COPY_SUFFIX = '_1';
const NO_MATERIAL = '(none)';

/**
 * The stable key of one raw primitive: its node path below the unnamed scene root, copies folded
 * onto their original, plus the raw material name. Node names alone repeat ("Geom3D", "").
 */
export function pajeroRawKeyOf(pathFromScene: readonly string[], materialName: string | null): string {
  if (pathFromScene.length < 2 || pathFromScene[0] !== '') {
    throw new Error(`pajeroRawKeyOf: the path "${pathFromScene.join('/')}" does not start at the unnamed scene root`);
  }
  const names = pathFromScene
    .slice(1)
    .map((name) => SOURCE_NAME_ALIASES[name] ?? name)
    .map((name) => (name.endsWith(COPY_SUFFIX) ? name.slice(0, -COPY_SUFFIX.length) : name));
  return `${names.join('/')}|${materialName ?? NO_MATERIAL}`;
}

export type PajeroDeletionReason =
  | 'frontBadge'
  | 'rearBadge'
  | 'steeringBadge'
  | 'modelScript'
  | 'hiddenLampPart'
  | 'garage';

export type PajeroBodySlot =
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

const PAJERO_BODY_SLOTS: readonly PajeroBodySlot[] = [
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

export type PajeroCornerPart = 'tyre' | 'rim' | 'rimDark' | 'brake' | 'caliper';

export type PajeroTargetKey = PajeroBodySlot | PajeroCornerPart;

type PajeroRawRole =
  | { kind: 'deleted'; reason: PajeroDeletionReason }
  | { kind: 'body'; slot: PajeroBodySlot }
  | { kind: 'corner'; part: PajeroCornerPart };

const body = (slot: PajeroBodySlot): PajeroRawRole => ({ kind: 'body', slot });
const corner = (part: PajeroCornerPart): PajeroRawRole => ({ kind: 'corner', part });

/**
 * Raw key -> role, for every primitive the source has (identified from renders of each key). The
 * "Pajero/…" interior group (steering wheel, dashboard, seats) comes from another model and is
 * mirrored into place; the node names mix Portuguese and Russian.
 */
export const PAJERO_RAW_ROLES: Readonly<Record<string, PajeroRawRole>> = {
  // The screen on top of the dashboard and its stand.
  'car/body/Component#3/Geom3D_Component#3|<Charcoal>': body('interior'),
  'car/body/Component#3/Geom3D|[Color_I06]': body('interior'),
  'car/body/Component#3/Component#1/Geom3D_Component#1|<Charcoal>': body('interior'),
  'car/body/skpF5A1/bonnet_ok/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  'car/body/skpF5A1/bump_front_o/Geom3D|vidro__spec_.000': body('clearGlass'),
  'car/body/skpF5A1/bump_front_o/Geom3D|Matte__FF808.000': body('blackTrim'),
  'car/body/skpF5A1/bump_front_o/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  // The chrome shields beside the grille; its three-diamond goes by PAJERO_BADGE_COMPONENTS.
  'car/body/skpF5A1/bump_front_o/Geom3D|[Metal Corrugated Shiny]': body('chrome'),
  // Fog-lamp reflectors.
  'car/body/skpF5A1/bump_front_o/Geom3D|Matte__FFC0C.000': body('headlight'),
  'car/body/skpF5A1/bump_front_o/Geom3D|black__spec_.000': body('blackTrim'),
  'car/body/skpF5A1/bump_front_o/Geom3D|interior__sp.000': body('blackTrim'),
  'car/body/skpF5A1/bump_front_o/Geom3D|*4': body('clearGlass'),
  'car/body/skpF5A1/bump_front_o/Geom3D|lampadas__sp': body('headlight'),
  'car/body/skpF5A1/bump_front_o/Geom3D|black1__spec': body('blackTrim'),
  'car/body/skpF5A1/bump_front_o/Geom3D|Mitsubishi All New Pajero Sport - chrome_blurry': body('silver'),
  'car/body/skpF5A1/bump_front_o/Geom3D|cinzin__spec': body('silver'),
  'car/body/skpF5A1/bump_front_o/Geom3D|[Color C05]': body('blackTrim'),
  'car/body/skpF5A1/bump_front_o//Geom3D|[Metal Corrugated Shiny]': body('chrome'),
  'car/body/skpF5A1/bump_front_o///Geom3D|[Metal Corrugated Shiny]': body('chrome'),
  // Dark inner housing of the headlamps.
  'car/body/skpF5A1/far_is//Geom3D|[Color B02]1': body('blackTrim'),
  'car/body/skpF5A1/far_is//Geom3D|*4': body('clearGlass'),
  'car/body/skpF5A1/farol_intern/Geom3D|Matte__FFC0C.000': body('headlight'),
  'car/body/skpF5A1/farol_intern/Geom3D|*2': body('headlight'),
  'car/body/skpF5A1/farol_intern/Geom3D|vehiclelight.000': body('headlight'),
  'car/body/skpF5A1/paralamas//Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  'car/body/skpF5A1/paralamas//Geom3D|Matte__FF808': body('blackTrim'),
  'car/body/skpF5A1/paralamas//Geom3D|interior__sp.000': body('blackTrim'),
  'car/body/skpF5A1//sp2/Geom3D|black1__spec.000': body('blackTrim'),
  'car/body/Pajero/rul/Geom3D|Standardmater1': body('interior'),
  // The plate under it, cut in the same shape.
  'car/body/Pajero/rul/Geom3D|Standardmater3': { kind: 'deleted', reason: 'steeringBadge' },
  // The three-diamond on the steering-wheel hub.
  'car/body/Pajero/rul/Geom3D|metal': { kind: 'deleted', reason: 'steeringBadge' },
  'car/body/Pajero/rul/Geom3D|*': body('interior'),
  'car/body/Pajero/rul/Geom3D|Color_005': body('interior'),
  'car/body/Pajero/siduli/Geom3D|*': body('interior'),
  // One stray triangle each, inside the cabin.
  'car/body/Pajero/door_rf_ok/Geom3D|Standardmater9': body('interior'),
  'car/body/Pajero/door_rr_ok/Geom3D|Standardmater9': body('interior'),
  'car/body/Pajero/priborka/Geom3D|*': body('interior'),
  'car/body/Pajero/priborka/Geom3D|Standardmater29': body('interior'),
  'car/body/Pajero/priborka/Geom3D|Standardmater3': body('interior'),
  'car/body/Pajero/priborka/Geom3D|Standardmater2': body('interior'),
  'car/body/Pajero/priborka/Geom3D|Standardmater5': body('interior'),
  'car/body/Pajero/priborka/Geom3D|Standardmater4': body('interior'),
  'car/body/Pajero/priborka/Geom3D|Standardmater112': body('interior'),
  'car/body/Pajero/priborka/Geom3D|Standardmater11': body('interior'),
  'car/body/Pajero/priborka/Geom3D|Standardmater16': body('interior'),
  'car/body/Pajero/priborka/Geom3D|Standardmater28': body('interior'),
  // The high-mounted stop lamp: a dark cover in the source, red on the real car.
  'car/body//light_stop_cover/Geom3D|Toyota Fortuner - clearglass1': body('taillight'),
  'car/body//body_spoiler/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  // Inside the opaque red lens, so never seen.
  'car/body/Bulbs_Detail_rear__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': { kind: 'deleted', reason: 'hiddenLampPart' },
  'car/body/Parktronics_rear__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  'car/body/Trunk__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  // The plate behind the "DAKAR" script.
  'car/body/Trunk__50_/Geom3D|[Metal Corrugated Shiny]': { kind: 'deleted', reason: 'modelScript' },
  'car/body/Trunk__50_/PAJERO SPORT/Geom3D|[Metal Corrugated Shiny]': { kind: 'deleted', reason: 'modelScript' },
  'car/body/Trunk__50_/DAKAR/Geom3D|*3': { kind: 'deleted', reason: 'modelScript' },
  // The white reversing-lamp part of each tail lamp.
  'car/body/Headlight_rear_reflector__50_/Geom3D|*1': body('headlight'),
  'car/body/Headlight_rear_reflector__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  'car/body/Bulbs_rear__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_7': body('headlight'),
  'car/body/Logo_rear__50_/Geom3D|[Metal Corrugated Shiny]': { kind: 'deleted', reason: 'rearBadge' },
  'car/body/Stair_chrome__50_/Geom3D|Mitsubishi All New Pajero Sport - chrome_blurry': body('silver'),
  'car/body/Bumper_rear__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  'car/body/Handle_trunk__50_/Geom3D|[Metal Corrugated Shiny]': body('chrome'),
  'car/body/Skirt_black__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('blackTrim'),
  'car/body/Mirror_chrome__50_/Geom3D|[Metal Corrugated Shiny]': body('chrome'),
  'car/body/Door_front__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  'car/body/Handle_front__50_/Geom3D|[Metal Corrugated Shiny]': body('chrome'),
  'car/body/seat__50_/Geom3D|Mitsubishi All New Pajero Sport - Foglamp': body('interior'),
  'car/body/Window_door_rear__50_/Geom3D|*5': body('glass'),
  'car/body/Bottom__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('blackTrim'),
  'car/body/Wing_front__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  // The triangle between the mirror and the A-pillar: body colour in the source, black on the real car.
  'car/body/Wing_front__50_//Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('blackTrim'),
  // The mirror glass.
  'car/body/Mirror__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_6': body('chrome'),
  // LED detail inside the opaque red lens, so never seen (23.5k triangles).
  'car/body/Headlight_rear_redglass_second__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_2': { kind: 'deleted', reason: 'hiddenLampPart' },
  'car/body/Windows_rear__50_/Geom3D|*5': body('glass'),
  'car/body/Roof__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  'car/body/Handle_rear__50_/Geom3D|[Metal Corrugated Shiny]': body('chrome'),
  'car/body/Wing_rear__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  'car/body/Wiper__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('blackTrim'),
  'car/body/Vanity_Mirror__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('interior'),
  'car/body/Headlight_rear_redglass__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_2': body('taillight'),
  'car/body/Wiper_rear__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('blackTrim'),
  'car/body/Stair_second__50_/Geom3D|Mitsubishi All New Pajero Sport - chrome_blurry': body('silver'),
  'car/body/Door_rear__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  'car/body/Window_door_front__50_/Geom3D|*5': body('glass'),
  'car/body/Windows_frame__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('blackTrim'),
  'car/body/Window_Hole__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('blackTrim'),
  'car/body/Trunk_black__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('blackTrim'),
  'car/body/Bumper_rear_second__50_/Geom3D|Mitsubishi All New Pajero Sport - chrome_blurry': body('silver'),
  // The indicator in each mirror cap and its lens.
  'car/body/Mirror_reflector__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('indicator'),
  'car/body/Wiper_second__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('blackTrim'),
  'car/body/Windows_frame_second__50_/Geom3D|Mitsubishi All New Pajero Sport - chrome_blurry': body('silver'),
  'car/body/Windows_frame_second__50_/Geom3D|[Metal Corrugated Shiny]': body('chrome'),
  'car/body/Mirror_black__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_1': body('blackTrim'),
  'car/body/Mirror_glass__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_7': body('indicator'),
  'car/body/Window_front__50_/Geom3D|*5': body('glass'),
  'car/body/Trunk_reflector__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4': body('paint'),
  // Rear-bumper reflectors.
  'car/body//Geom3D|*6': body('taillight'),
  // Wheels: tyre, two-tone rim, centre cap with nuts, caliper and disc.
  'car////Geom3D|[Color J08]': corner('tyre'),
  'car////Componente#78/Geom3D|[Color M09]': corner('rimDark'),
  'car////Componente#80/Geom3D|[Color M02]': corner('rim'),
  'car////Componente#79/Geom3D|[Color M08]': corner('rim'),
  'car////black_13/Geom3D|black': corner('rimDark'),
  'car////silver_12/Geom3D|gum': corner('caliper'),
  'car////silver_13/Geom3D|silver': corner('brake'),
  // The garage backdrop: walls, floor and ceiling.
  '/Geom3D|body1': { kind: 'deleted', reason: 'garage' },
  '/Geom3D|[Asphalt New]': { kind: 'deleted', reason: 'garage' },
  '/Geom3D|chrome': { kind: 'deleted', reason: 'garage' },
  '/Geom3D_|(none)': { kind: 'deleted', reason: 'garage' },
};

/** Hub of the left wheels is at -x; the right wheels mirror it. Measured on the tyre bounds. */
export const PAJERO_HUB = { x: 0.7568, y: 0.3981 } as const;
export const PAJERO_WHEEL_Z = { front: 1.4942, rear: -1.3058 } as const;
/** The rim face sits 12 cm outboard of the tyre centre, and the caliper 13 cm off the axle. */
const HUB_AXIAL_TOLERANCE = 0.15;
const HUB_RADIAL_TOLERANCE: Readonly<Record<PajeroCornerPart, number>> = {
  tyre: 0.02,
  rim: 0.02,
  rimDark: 0.02,
  brake: 0.02,
  caliper: 0.16,
};

export interface PajeroBox {
  min: PajeroVector;
  max: PajeroVector;
}

/**
 * Badges that are one connected piece inside a larger raw part, in car space. A component is
 * removed only when it lies fully inside the box.
 */
export const PAJERO_BADGE_COMPONENTS: Readonly<Record<string, { reason: PajeroDeletionReason; box: PajeroBox }>> = {
  // The three-diamond on the grille; the same part holds the two chrome side shields, which stay.
  'car/body/skpF5A1/bump_front_o/Geom3D|[Metal Corrugated Shiny]': {
    reason: 'frontBadge',
    box: { min: { x: -0.09, y: 0.9, z: 2.28 }, max: { x: 0.09, y: 1.05, z: 2.41 } },
  },
};

/**
 * The source has no headliner or pillar trim: seen from the driver's seat, the roof, pillars, doors
 * and floor are back faces and vanish. The converter adds a reversed copy of every triangle of these
 * slots whose centre is inside the cabin box, so the shell also shows from inside.
 */
export const PAJERO_CABIN_SHELL = {
  slots: ['paint', 'blackTrim'],
  box: { min: { x: -1.0, y: 0.3, z: -1.3 }, max: { x: 1.0, y: 1.9, z: 1.15 } },
} as const satisfies { slots: readonly PajeroBodySlot[]; box: PajeroBox };

/** Whether a triangle of a body slot, by its centre in car space, gets a reversed inside copy. */
export function pajeroNeedsInsideFace(slot: CarMaterialSlot, centre: PajeroVector): boolean {
  const { slots, box } = PAJERO_CABIN_SHELL;
  if (!slots.some((shellSlot) => shellSlot === slot)) return false;
  return (
    centre.x >= box.min.x && centre.x <= box.max.x &&
    centre.y >= box.min.y && centre.y <= box.max.y &&
    centre.z >= box.min.z && centre.z <= box.max.z
  );
}

export const PAJERO_TRIANGLE_TARGETS: Readonly<Record<PajeroTargetKey, number>> = {
  paint: 40000,
  blackTrim: 14000,
  interior: 13000,
  chrome: 7000,
  headlight: 6000,
  silver: 3500,
  taillight: 3500,
  clearGlass: 2500,
  glass: 3000,
  indicator: 400,
  plate: 2,
  tyre: 2800,
  rim: 2600,
  rimDark: 1800,
  caliper: 500,
  brake: 200,
};

/**
 * The blank rear plate. The source has none; it sits in the tailgate recess between the lamps,
 * 1 cm off the surface. The recess leans forward by atan(0.199) (measured on its centre line).
 */
export const PAJERO_PLATE = {
  width: 0.52,
  height: 0.112,
  centre: { x: 0, y: 0.9685, z: -2.36 },
  leanRadians: Math.atan(0.199),
} as const;

/** Two triangles facing backward and up, wound counter-clockwise as seen from behind the car. */
export function pajeroPlateQuad(): { positions: Float32Array; indices: Uint32Array } {
  const { width, height, centre, leanRadians } = PAJERO_PLATE;
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
export interface PajeroPartSample {
  rawKey: string;
  centre: PajeroVector;
  size: PajeroVector;
}

export type PajeroPartClass =
  | { kind: 'deleted'; reason: PajeroDeletionReason }
  | {
      kind: 'part';
      cleanId: string;
      slot: CarMaterialSlot;
      targetKey: PajeroTargetKey;
      /** Where the part's vertices are centred and its node is placed; null keeps car space. */
      hub: PajeroVector | null;
    };

const CORNER_PART_SLOTS: Readonly<Record<PajeroCornerPart, CarMaterialSlot>> = {
  tyre: 'rubber',
  rim: 'rim',
  rimDark: 'rimDark',
  brake: 'brake',
  // Bare cast iron on the real car: dark, not the bright disc metal.
  caliper: 'blackTrim',
};

const WHEEL_SLOTS: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const CORNER_PARTS: readonly PajeroCornerPart[] = ['tyre', 'rim', 'rimDark', 'brake', 'caliper'];

const CORNER_LETTERS: Readonly<Record<WheelSlot, string>> = {
  wheelFL: 'FL',
  wheelFR: 'FR',
  wheelRL: 'RL',
  wheelRR: 'RR',
};

function cornerPartId(wheel: WheelSlot, part: PajeroCornerPart): string {
  const letters = CORNER_LETTERS[wheel];
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

const CORNER_PART_BY_ID: ReadonlyMap<string, { wheel: WheelSlot; part: PajeroCornerPart }> = new Map(
  WHEEL_SLOTS.flatMap((wheel) => CORNER_PARTS.map((part) => [cornerPartId(wheel, part), { wheel, part }] as const)),
);

function isPajeroBodySlot(nodeId: string): nodeId is PajeroBodySlot {
  return PAJERO_BODY_SLOTS.some((slot) => slot === nodeId);
}

/** The hub a corner part belongs to. The game rig puts its left wheels at negative X. */
export function pajeroHubOf(centre: PajeroVector, part: PajeroCornerPart): { wheel: WheelSlot; hub: PajeroVector } {
  const isFront = centre.z > (PAJERO_WHEEL_Z.front + PAJERO_WHEEL_Z.rear) / 2;
  const isLeft = centre.x < 0;
  const hub = {
    x: isLeft ? -PAJERO_HUB.x : PAJERO_HUB.x,
    y: PAJERO_HUB.y,
    z: isFront ? PAJERO_WHEEL_Z.front : PAJERO_WHEEL_Z.rear,
  };
  const radialDistance = Math.hypot(centre.y - hub.y, centre.z - hub.z);
  const axialDistance = Math.abs(centre.x - hub.x);
  if (radialDistance > HUB_RADIAL_TOLERANCE[part] || axialDistance > HUB_AXIAL_TOLERANCE) {
    throw new Error(
      `pajeroHubOf: a ${part} centred at (${centre.x.toFixed(3)}, ${centre.y.toFixed(3)}, ${centre.z.toFixed(3)}) is ${radialDistance.toFixed(3)} m off the nearest hub axis and ${axialDistance.toFixed(3)} m along it`,
    );
  }
  const wheel: WheelSlot = isFront ? (isLeft ? 'wheelFL' : 'wheelFR') : isLeft ? 'wheelRL' : 'wheelRR';
  return { wheel, hub };
}

/** Decides what the converter does with one raw primitive: delete it, or which clean id it joins. */
export function classifyPajeroPart(sample: PajeroPartSample): PajeroPartClass {
  const role = PAJERO_RAW_ROLES[sample.rawKey];
  if (!role) throw new Error(`classifyPajeroPart: no role for raw key "${sample.rawKey}"`);
  switch (role.kind) {
    case 'deleted':
      return { kind: 'deleted', reason: role.reason };
    case 'body':
      return { kind: 'part', cleanId: role.slot, slot: role.slot, targetKey: role.slot, hub: null };
    case 'corner': {
      const { wheel, hub } = pajeroHubOf(sample.centre, role.part);
      return { kind: 'part', cleanId: cornerPartId(wheel, role.part), slot: CORNER_PART_SLOTS[role.part], targetKey: role.part, hub };
    }
  }
}

function isInside(box: PajeroBox, component: PajeroBox): boolean {
  return (
    component.min.x >= box.min.x &&
    component.min.y >= box.min.y &&
    component.min.z >= box.min.z &&
    component.max.x <= box.max.x &&
    component.max.y <= box.max.y &&
    component.max.z <= box.max.z
  );
}

/** Whether one connected component of a raw part, in car space, is a badge. */
export function pajeroBadgeReasonOf(rawKey: string, component: PajeroBox): PajeroDeletionReason | null {
  const rule = PAJERO_BADGE_COMPONENTS[rawKey];
  if (!rule) return null;
  return isInside(rule.box, component) ? rule.reason : null;
}

/** Material slot for a clean node id of the converted GLB. Throws on an unknown id (no default slot). */
export function pajeroMaterialSlotFor(nodeId: string): CarMaterialSlot {
  if (isPajeroBodySlot(nodeId)) return nodeId;
  const cornerPart = CORNER_PART_BY_ID.get(nodeId);
  if (!cornerPart) throw new Error(`pajeroMaterialSlotFor: no material slot documented for node id "${nodeId}"`);
  return CORNER_PART_SLOTS[cornerPart.part];
}

function cornerPartOrBody(nodeId: string): { wheel: WheelSlot; part: PajeroCornerPart } | null {
  const cornerPart = CORNER_PART_BY_ID.get(nodeId);
  if (cornerPart) return cornerPart;
  if (isPajeroBodySlot(nodeId)) return null;
  throw new Error(`PAJERO_GEN3_ASSEMBLY_RULES: unknown node id "${nodeId}"`);
}

export const PAJERO_GEN3_ASSEMBLY_RULES: CarAssemblyRules = {
  wheelCornerOf(nodeId) {
    return cornerPartOrBody(nodeId)?.wheel ?? null;
  },
  spinsWithWheel(nodeId) {
    const part = cornerPartOrBody(nodeId)?.part;
    return part === 'tyre' || part === 'rim' || part === 'rimDark';
  },
  slotFor: pajeroMaterialSlotFor,
  tyreNodeIdOf(slot) {
    return cornerPartId(slot, 'tyre');
  },
  needsCylindricalUv(nodeId) {
    // The source tyre has no maps, so it takes the generated tread.
    return cornerPartOrBody(nodeId)?.part === 'tyre';
  },
};

/** Measured on the converted GLB and printed by scripts/convert-pajero.ts. */
export const measuredCarPajeroGen3 = {
  wheelbase: 2.8,
  track: 1.5136,
  tyreRadius: 0.3982,
  tyreWidth: 0.289,
  wheelCentreY: 0.3981,
  archTopY: 0.8811,
  length: 4.83,
} as const;
