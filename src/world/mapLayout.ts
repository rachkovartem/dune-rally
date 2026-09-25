// src/world/mapLayout.ts
// Klipfontein as data: every place, line and number of the approved map design, in world metres
// (x east, z south, north is −z). Pure constants only; the height layers, covers and features read
// them, so a coordinate is changed here and nowhere else. Data for later steps is already here.
import type { Point2 } from './polyline';

export interface Circle {
  x: number;
  z: number;
  radius: number;
}

export interface Ellipse {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
}

export interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export type MapSide = 'north' | 'east' | 'south' | 'west';

export const MAP_SIZE = 3072;

// ── base plain (design §12.1 step 1) ──────────────────────────────────────────────────
// The fine relief keeps the plan's amplitudes on longer wavelengths: simplex noise bends more
// sharply than a sine of the same wavelength, and every bump must stay above a 170 m radius so a
// car stays planted at real gravity (measured: 200 m).
export const BASE_PLAIN = {
  level: 10,
  centre: MAP_SIZE / 2,
  /** Height change per metre: the plain rises to the east and to the north (−z). */
  tiltX: 0.005,
  tiltZ: -0.005,
  swell: { amplitude: 2.2, wavelength: 320, octaves: 3 },
  micro: [
    { amplitude: 0.25, wavelength: 60 },
    { amplitude: 0.35, wavelength: 120 },
  ],
} as const;

// ── border: the Randberge (design §2) ─────────────────────────────────────────────────
export interface CrestBand {
  /** Crest height above the plain beside it, metres. */
  min: number;
  max: number;
}

export const BORDER = {
  /** Metres from the map edge where the gravel apron starts; the value wanders by `apronWander`. */
  apronStart: 220,
  apronWander: 45,
  /** Metres from the map edge of the inner foot of the steep face. */
  faceFoot: 150,
  /** Metres from the map edge of the top of the face; the crest keeps rising a little outward. */
  faceTop: 70,
  crest: {
    north: { min: 55, max: 70 },
    east: { min: 45, max: 60 },
    south: { min: 30, max: 40 },
    west: { min: 45, max: 60 },
  } satisfies Record<MapSide, CrestBand>,
} as const;

/** The dry river leaves the range here and ends at an 8 m dry waterfall (design §2). */
export const NW_GORGE = {
  area: { minX: 200, minZ: 620, maxX: 330, maxZ: 720 } satisfies Box,
  /** Centre line from the mouth on the plain to the foot of the dry waterfall. */
  mouth: { x: 330, z: 690 },
  waterfall: { x: 205, z: 668 },
  waterfallStep: 8,
} as const;

// ── landforms (design §3) ─────────────────────────────────────────────────────────────
export interface Koppie extends Circle {
  name: string;
  /** Top above the plain, metres. */
  height: number;
}

export const GROOT_KOPPIE: Koppie = { name: 'Groot Koppie', x: 1480, z: 600, radius: 175, height: 70 };

export const KLEIN_KOPPIES: readonly Koppie[] = [
  { name: 'Klein Koppie', x: 1700, z: 720, radius: 95, height: 32 },
  { name: 'West Koppie', x: 1290, z: 760, radius: 70, height: 22 },
  { name: 'Far West Koppie', x: 1030, z: 520, radius: 55, height: 16 },
];

export const KOPPIES: readonly Koppie[] = [GROOT_KOPPIE, ...KLEIN_KOPPIES];

/** The dome profile is height × (1 − d²)^exponent, d = distance / radius. */
export const KOPPIE_DOME_EXPONENT = 1.6;

export const TAFELKOP = {
  x: 2450,
  z: 520,
  topRadius: 115,
  skirt: 55,
  height: 45,
  /** How far (m) the rim wanders in and out around the hill. */
  edgeWander: 10,
} as const;

export const DOLERITE_RIDGE = {
  line: [{ x: 1990, z: 2090 }, { x: 2400, z: 2130 }, { x: 2860, z: 2170 }] satisfies Point2[],
  halfWidth: 100,
  minHeight: 30,
  maxHeight: 35,
} as const;

export const SPAWN_RISE = { x: 1560, z: 2020, rise: 4, top: 30, skirt: 60 } as const;

// ── spawn (design §7) ─────────────────────────────────────────────────────────────────
/** The farm gate on the spine; cars start south of it, facing north. */
export const FARM_GATE = { x: 1560, z: 2000 } as const;

export const SPAWN_GRID = {
  columns: 4,
  rows: 3,
  columnSpacing: 5,
  rowSpacing: 7,
  /** Metres south of the gate of the front row. */
  frontRowBehindGate: 30,
} as const;

// ── later steps: flats, cuts, dunes (design §3, §6, §12) ──────────────────────────────
export const DORP_YARD = { x: 1580, z: 1330, width: 120, depth: 80, rise: 1.5 } as const;

export const DAM = {
  water: { x: 1370, z: 1250, radiusX: 55, radiusZ: 40 } satisfies Ellipse,
  bowlDepth: 3.5,
  /** Water surface below the plain beside the dam. */
  waterBelowPlain: 0.5,
  wall: { from: { x: 1310, z: 1300 }, to: { x: 1400, z: 1300 }, crestWidth: 5, height: 3, sideSlope: 0.4, length: 160 },
} as const;

export const SANDRIVIER = {
  line: [
    { x: 300, z: 690 }, { x: 600, z: 800 }, { x: 820, z: 1100 }, { x: 760, z: 1450 },
    { x: 980, z: 1700 }, { x: 900, z: 2050 }, { x: 700, z: 2300 }, { x: 640, z: 2440 },
  ] satisfies Point2[],
  bedWidth: { north: 25, south: 40 },
  depth: { north: 3, middle: 5, delta: 0 },
  outsideBankSlope: { min: 0.6, max: 0.8 },
  insideBankSlope: { min: 0.15, max: 0.25 },
  drifts: [{ x: 830, z: 1120 }, { x: 800, z: 2180 }] satisfies Point2[],
} as const;

export const SOUTPAN: Ellipse = { x: 1050, z: 2560, radiusX: 700, radiusZ: 260 };
export const SOUTPAN_BLEND = 80;

export const WIT_DUINE = {
  area: { minX: 2150, minZ: 900, maxX: 2850, maxZ: 1900 } satisfies Box,
  feather: 80,
  spacing: { west: 60, east: 120 },
  amplitude: { west: 4, east: 20 },
  bigDaddy: { x: 2650, z: 1360, height: 25 },
  whoops: { minX: 2170, minZ: 1230, maxX: 2450, maxZ: 1280 } satisfies Box,
  slipFaceMax: 0.58,
} as const;

export const GRUISGAT = { x: 1820, z: 1060, width: 140, depth: 100, pitDepth: 6 } as const;

export const KLIPSPRINGER_POORT = { minX: 2340, maxX: 2410, narrowest: 12, wallHeight: 25 } as const;

// ── routes (design §4) ─────────────────────────────────────────────────────────────────
export type RouteKind = 'road' | 'track' | 'line';

export interface Route {
  name: string;
  kind: RouteKind;
  /** Raw waypoints before smoothing. */
  points: readonly Point2[];
}

const KOPPIE_JUNCTION: Point2 = { x: 1560, z: 950 };
const TAFELKOP_FOOT: Point2 = { x: 2250, z: 760 };

export const ROAD_WIDTH = 7;
export const ROAD_SHOULDER_WIDTH = 2;
export const TRACK_WIDTH = 4;

export const ROUTES: readonly Route[] = [
  { name: 'Spine', kind: 'road', points: [FARM_GATE, { x: 1560, z: 1800 }, { x: 1560, z: 1340 }, KOPPIE_JUNCTION] },
  {
    name: 'Plaaslus', kind: 'road', points: [
      KOPPIE_JUNCTION, { x: 1150, z: 1000 }, { x: 830, z: 1120 }, { x: 560, z: 1350 }, { x: 520, z: 1800 },
      { x: 600, z: 2200 }, { x: 800, z: 2180 }, { x: 1100, z: 2240 }, { x: 1450, z: 2150 }, FARM_GATE,
    ],
  },
  {
    name: 'Ooslus', kind: 'road', points: [
      KOPPIE_JUNCTION, { x: 1950, z: 820 }, TAFELKOP_FOOT, { x: 2060, z: 1100 }, { x: 2060, z: 1600 },
      { x: 1880, z: 1950 }, FARM_GATE,
    ],
  },
  { name: 'Panpad', kind: 'road', points: [{ x: 1560, z: 2020 }, { x: 1650, z: 2300 }, { x: 1800, z: 2560 }] },
  { name: 'Die Myl', kind: 'road', points: [{ x: 2650, z: 2560 }, { x: 1750, z: 2560 }, { x: 400, z: 2560 }] },
  {
    name: 'Klipspringer Poort', kind: 'track', points: [
      { x: 2060, z: 1600 }, { x: 2410, z: 1920 }, { x: 2340, z: 2050 }, { x: 2400, z: 2180 },
      { x: 2390, z: 2330 }, { x: 2420, z: 2560 },
    ],
  },
  { name: 'Tafelkop Pas', kind: 'track', points: [TAFELKOP_FOOT, { x: 2380, z: 630 }, { x: 2370, z: 600 }] },
  {
    name: 'Koppie Klim', kind: 'track', points: [
      KOPPIE_JUNCTION, { x: 1640, z: 860 }, { x: 1600, z: 780 }, { x: 1640, z: 720 }, { x: 1570, z: 650 },
    ],
  },
  {
    name: 'Duinetrek', kind: 'line', points: [
      { x: 2060, z: 1300 }, { x: 2190, z: 1250 }, { x: 2300, z: 1260 }, { x: 2500, z: 1380 }, { x: 2650, z: 1360 },
      { x: 2780, z: 1500 }, { x: 2600, z: 1700 }, { x: 2410, z: 1920 },
    ],
  },
];

/** The flat-out line across the pan (design §4, AC1). */
export const DIE_MYL = { from: { x: 2650, z: 2560 }, panEdge: { x: 1750, z: 2560 }, to: { x: 400, z: 2560 } } as const;

// ── jumps (design §9; the numbers for real gravity live in plan v3 S2-1) ───────────────
export type JumpId = 'J1' | 'J2' | 'J3' | 'J4' | 'J5' | 'J6' | 'J7' | 'J8';

export const JUMP_SPOTS: Readonly<Record<JumpId, readonly Point2[]>> = {
  J1: [{ x: 1560, z: 1800 }],
  J2: SANDRIVIER.drifts,
  J3: [{ x: 1355, z: 1300 }],
  J4: [{ x: 2310, z: 1255 }],
  J5: [{ x: 2650, z: 1360 }],
  J6: [{ x: 740, z: 1470 }],
  J7: [{ x: 1820, z: 1060 }],
  J8: [{ x: 2370, z: 2100 }],
};

// ── landmarks, meeting spots and viewpoints (design §5, §8, §10) ──────────────────────
export interface Landmark extends Point2 {
  name: string;
  /** Top above the plain, metres. */
  height: number;
}

export const MAP_LANDMARKS: readonly Landmark[] = [
  { name: 'Groot Koppie', x: GROOT_KOPPIE.x, z: GROOT_KOPPIE.z, height: GROOT_KOPPIE.height },
  { name: 'Windpump', x: 1570, z: 1345, height: 12 },
  { name: 'Tafelkop', x: TAFELKOP.x, z: TAFELKOP.z, height: TAFELKOP.height },
  { name: 'Radio mast', x: 2470, z: 480, height: TAFELKOP.height + 25 },
  { name: 'Big Daddy', x: WIT_DUINE.bigDaddy.x, z: WIT_DUINE.bigDaddy.z, height: WIT_DUINE.bigDaddy.height },
  { name: 'Dolerite ridge', x: 2400, z: 2130, height: DOLERITE_RIDGE.maxHeight },
  { name: 'Dam', x: DAM.water.x, z: DAM.water.z, height: 0 },
];

export type MeetingSpotId = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

export const MEETING_SPOTS: Readonly<Record<MeetingSpotId, Point2>> = {
  M1: { x: SPAWN_RISE.x, z: SPAWN_RISE.z },
  M2: { x: DORP_YARD.x, z: DORP_YARD.z },
  M3: { x: 2370, z: 600 },
  M4: { x: GRUISGAT.x, z: GRUISGAT.z },
  M5: { x: 1750, z: 2560 },
};

/** Where the border must stay under the HDRI mountains (≤ 2.5° up, design §2 and AC5). */
export const VIEWPOINTS: Readonly<Record<'spawn' | 'dorp' | 'overlook', Point2>> = {
  spawn: { x: SPAWN_RISE.x, z: SPAWN_RISE.z },
  dorp: { x: DORP_YARD.x, z: DORP_YARD.z },
  overlook: MEETING_SPOTS.M3,
};

export const POWER_LINE = { from: { x: 1600, z: 1330 }, to: { x: 2470, z: 480 }, poleSpacing: 60, poleHeight: 8 } as const;

export const FENCE = { z: 1990, fromX: 1150, toX: 1990 } as const;
