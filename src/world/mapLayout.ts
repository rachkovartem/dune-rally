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

/**
 * A koppie from its foot up: apron, a rock band all round, shoulder, tor. Radii and drops are shares
 * of its radius and height. No car climbs the band (measured: rock up to 0.7 for the Pajero, 0.62 for
 * the Forester), so the only way onto a shoulder is a track cut through it.
 */
export const KOPPIE_PROFILE = {
  top: { radius: 0.14, drop: 0.06 },
  tor: { centre: 0.22, width: 0.12, drop: 0.3 },
  shoulder: { drop: 0.1 },
  /**
   * The band rises from its foot at `toeSlope` and rounds over at its top, so its width follows
   * from its height. The border face uses the same toe (measured: below about 2 a car at speed runs up).
   */
  band: { centre: 0.68, drop: 0.34, toeSlope: 3 },
  /** How much of the height the band gains or loses around the koppie; the shoulder takes the rest. */
  bandSwing: 0.08,
  /** How far in (share of the radius) the outline can wander; it never reaches past the radius. */
  outline: 0.16,
  /** How far (share of the radius) the band and the tor wander in and out on top of that. */
  wander: 0.04,
} as const;

/** Ridged boulder lumps on the koppies (design §12.1): metres high, and their size on the ground. */
export const KOPPIE_LUMPS = { heightPerMetre: 1 / 18, minHeight: 2, maxHeight: 4, wavelength: 32 } as const;

/**
 * The rocky spur the Koppie Klim rides from Klein Koppie's shoulder to the Groot Koppie saddle
 * (design §4): its crest climbs from the koppie ground at one end to the ground at the other.
 */
export const KLIM_SPUR = {
  from: { x: 1640, z: 720 },
  to: { x: 1570, z: 650 },
  topHalfWidth: 5,
  sideSlope: 1.1,
} as const;

export const TAFELKOP = {
  x: 2450,
  z: 520,
  topRadius: 115,
  skirt: 55,
  height: 45,
  /** How far (m) the rim wanders in and out around the hill. */
  edgeWander: 10,
  /**
   * The Tafelkop Pas climbs a talus on the west-south-west side: there the skirt widens to
   * `skirt` metres around `angle` (degrees from +x toward +z), fading out over `halfAngle`.
   */
  talus: { angle: 165, halfAngle: 40, skirt: 110 },
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
  /** The first metres of the bed, inside the NW gorge, where it deepens from the gorge floor. */
  headLength: 90,
  /** The last metres of the bed, where it grows shallow and opens onto the pan. */
  deltaLength: 350,
  /** A drift is a road ramp down the banks: its width, and its slope. */
  drift: { width: 12, rampSlope: 0.15 },
} as const;

export const SOUTPAN: Ellipse = { x: 1050, z: 2560, radiusX: 700, radiusZ: 260 };
/** Metres inside the ellipse over which the flat salt blends into the ground around it. */
export const SOUTPAN_BLEND = 80;
/**
 * Metres outside the ellipse over which the ground already leans down toward the pan. The plain
 * stands up to 9 m above the salt at the east end, and a short blend there would be a lip that
 * throws a car off Die Myl.
 */
export const SOUTPAN_OUTER_BLEND = 170;
/** The pan is the lowest ground: within `reach` metres of it the valley stays `base` above the salt. */
export const SOUTPAN_FLOOR = { base: 0.3, reach: 300 } as const;

export const WIT_DUINE = {
  area: { minX: 2150, minZ: 900, maxX: 2850, maxZ: 1900 } satisfies Box,
  feather: 80,
  spacing: { west: 60, east: 120 },
  amplitude: { west: 4, east: 20 },
  bigDaddy: { x: 2650, z: 1360, height: 25, radius: 100 },
  whoops: { minX: 2170, minZ: 1230, maxX: 2450, maxZ: 1280 } satisfies Box,
  /** Design 0.55–0.65; capped so the Pajero can still climb one at real gravity (plan v3). */
  slipFaceMax: 0.58,
  /** The brink between the windward side and the slip face is rounded to this radius. */
  brinkRadius: 12,
} as const;

// ── Gruisgat: the old gravel quarry, the stunt park (design §3 Z11, §9 J7) ─────────────
export type CompassDirection = 'north' | 'east' | 'south' | 'west';

export interface QuarryHeap {
  /** Top of the heap above its base, metres (J7: 2.5 / 3.5 / 4 / 6). */
  height: number;
  /** The lip, where a car leaves the heap. */
  lip: Point2;
  /** The way a car flies off the lip. */
  launch: CompassDirection;
  /** On the pit floor, or on the plain at the rim (it then throws a car into the pit). */
  base: 'floor' | 'rim';
}

export interface QuarryRamp {
  /** The rim side the ramp climbs out through. */
  side: CompassDirection;
  /** Position along that side: z on the west and east sides, x on the north and south sides. */
  at: number;
}

export const GRUISGAT = {
  x: 1820,
  z: 1060,
  /** The rim, a rounded rectangle. */
  width: 140,
  depth: 100,
  pitDepth: 6,
  /** Metres from the rim to the flat floor (and the rim's corner radius); the wall is steepest (0.45) half way down. */
  wallWidth: 20,
  ramp: { halfWidth: 5, slope: 0.2, sideSlope: 0.6 },
  ramps: [{ side: 'west', at: 1078 }, { side: 'east', at: 1045 }] satisfies QuarryRamp[],
  heap: { rampSlope: 0.3, backSlope: 0.75, sideSlope: 0.8, topHalfWidth: 3 },
  heaps: [
    { height: 6, lip: { x: 1845, z: 1045 }, launch: 'west', base: 'floor' },
    { height: 4, lip: { x: 1790, z: 1078 }, launch: 'east', base: 'floor' },
    { height: 3.5, lip: { x: 1815, z: 1010 }, launch: 'south', base: 'rim' },
    { height: 2.5, lip: { x: 1890, z: 1062 }, launch: 'west', base: 'rim' },
  ] satisfies QuarryHeap[],
  /** Every heap has at least this much clear floor straight ahead of its lip (plan v3 J7). */
  minLanding: 55,
} as const;

// ── Klipspringer Poort: the canyon through the dolerite ridge (design §3 Z10, §9 J8) ──
export const KLIPSPRINGER_POORT = {
  /** Floor width where the canyon is widest and where it is tightest, metres. */
  width: { wide: 26, narrowest: 12 },
  /** Share of the canyon's length where it is tightest, and over how much of it it narrows. */
  tightestAt: 0.5,
  tighteningLength: 0.35,
  wallSlope: 2.4,
  /** The rock steps a car drops down going south, in order (J8). Positions are shares of the canyon. */
  steps: [{ at: 0.3, height: 0.5 }, { at: 0.55, height: 0.65 }, { at: 0.78, height: 0.8 }],
  /** Horizontal metres each step face takes. */
  stepRun: 1.6,
  /** The canyon runs this far past where the ridge starts to rise, at each end. */
  endMargin: 25,
} as const;

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
/** Track centre lines are smoothed and resampled at this step, metres (tighter than roads: hairpins). */
export const TRACK_SPACING = 2;

export type TrackCover = 'gravel' | 'dirt';

/** How a track is graded into the ground (plan v3 S3-1). */
export interface TrackGrading {
  /** Half the width of the running surface, metres. */
  halfWidth: number;
  /** Steepest grade along the line before any rock step. */
  maxGrade: number;
  /**
   * Where the ground is uneven the line goes between the highest (fill) and lowest (cut) line the
   * grade allows: 0 cuts all the way, 1 fills all the way.
   */
  fillShare: number;
  /** Beside the running surface: the cut face rises at `cutSlope`, the fill falls at `fillSlope`. */
  cutSlope: number;
  fillSlope: number;
  cover: TrackCover;
  /** Waypoint indices between which the line climbs at one steady grade, whatever the ground. */
  steadyClimb: { from: number; to: number } | null;
  /** Waypoint indices of hairpin apexes, where the running surface widens to `hairpinHalfWidth`. */
  hairpins: readonly number[];
  hairpinHalfWidth: number;
  /** Rock steps along the line: how many, how high, how long each face is, and between which waypoints. */
  rockSteps: { count: number; height: number; run: number; from: number; to: number } | null;
}

export const TRACK_GRADING: Readonly<Record<string, TrackGrading>> = {
  // Design §4: rock and gravel, boulder steps, slope up to 0.35 (steps included).
  'Koppie Klim': {
    halfWidth: 2.5, maxGrade: 0.24, fillShare: 0.65, cutSlope: 1.2, fillSlope: 1.0, cover: 'gravel',
    steadyClimb: null, hairpins: [], hairpinHalfWidth: 2.5,
    rockSteps: { count: 5, height: 0.35, run: 1.2, from: 2, to: 4 },
  },
  // Design §4: 45 m at 10–15 %, three hairpins, a drop on the outside.
  'Tafelkop Pas': {
    halfWidth: 2.5, maxGrade: 0.145, fillShare: 0.5, cutSlope: 1.3, fillSlope: 0.9, cover: 'gravel',
    steadyClimb: { from: 1, to: 19 }, hairpins: [6, 12, 18], hairpinHalfWidth: 7, rockSteps: null,
  },
  // Design §4: dirt, then the canyon floor with its rock steps. Its sides stay as gentle as the
  // dunes it crosses, so the dune field keeps its slope limit.
  'Klipspringer Poort': {
    halfWidth: 2.5, maxGrade: 0.12, fillShare: 0.5, cutSlope: 0.5, fillSlope: 0.5, cover: 'dirt',
    steadyClimb: null, hairpins: [], hairpinHalfWidth: 2.5, rockSteps: null,
  },
};

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
  // The gravel part is graded down the pan's edge to where the flat salt starts; the rest of the
  // mile is the pan itself.
  { name: 'Die Myl', kind: 'road', points: [{ x: 2650, z: 2560 }, { x: 1750, z: 2560 }, { x: 1670, z: 2560 }] },
  { name: 'Die Myl on the salt', kind: 'line', points: [{ x: 1670, z: 2560 }, { x: 400, z: 2560 }] },
  {
    name: 'Klipspringer Poort', kind: 'track', points: [
      { x: 2060, z: 1600 }, { x: 2410, z: 1920 }, { x: 2340, z: 2050 }, { x: 2400, z: 2180 },
      { x: 2390, z: 2330 }, { x: 2420, z: 2560 },
    ],
  },
  // Three hairpins on the talus of the west-south-west face, each a 180° turn of about 7 m radius,
  // then along the top to the overlook. The radii follow the talus, so the cuts and fills stay small.
  {
    name: 'Tafelkop Pas', kind: 'track', points: [
      TAFELKOP_FOOT, { x: 2271, z: 645 }, { x: 2265, z: 622 }, { x: 2261, z: 598 }, { x: 2260, z: 575 },
      { x: 2262, z: 553 }, { x: 2267, z: 536 }, { x: 2276, z: 551 }, { x: 2283, z: 569 }, { x: 2292, z: 585 },
      { x: 2303, z: 601 }, { x: 2315, z: 615 }, { x: 2329, z: 622 }, { x: 2326, z: 607 }, { x: 2318, z: 592 },
      { x: 2312, z: 577 }, { x: 2308, z: 561 }, { x: 2305, z: 546 }, { x: 2311, z: 532 }, { x: 2319, z: 543 },
      { x: 2348, z: 561 }, { x: 2366, z: 591 }, { x: 2370, z: 600 },
    ],
  },
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

// ── road grading (design §12.4, plan v3 S2-1) ──────────────────────────────────────────
export const ROAD_GRADING = {
  /** Centre lines are smoothed and resampled at this step, metres. */
  spacing: 4,
  /** The profile starts from the ground averaged over a disc of this radius. */
  averageRadius: 60,
  maxGrade: 0.08,
  /** The road is never more than this far below the ground `sideProbe` metres to either side. */
  maxBelowGround: 1.0,
  sideProbe: 5.5,
  /** Every road sits this much above its graded line (the design's crown). */
  crownRise: 0.25,
  /** The running surface falls this much from the centre to its edge, then the shoulder this much more. */
  crownDrop: 0.05,
  shoulderDrop: 0.04,
  /** Crests of the graded line are no sharper than this, so a car stays planted at top speed. */
  minCrestRadius: 300,
  /** Beside the shoulder the ground blends back over max(min, factor × height difference), at most max. */
  batter: { factor: 3, min: 6, max: 24 },
} as const;

// ── pads: flats that are level whatever the ground does (design §12.4) ────────────────
export type PadShape =
  | { kind: 'circle'; x: number; z: number; radius: number }
  | { kind: 'rectangle'; x: number; z: number; width: number; depth: number };

export interface PadDef {
  name: string;
  shape: PadShape;
  /** Metres over which the pad blends back into the ground around it. */
  blend: number;
  /** Height of the pad above max(mean, 80th percentile) of the ground under it. */
  rise: number;
}

/** A pad stands on this share of the ground under it, so it is never a pit. */
export const PAD_PERCENTILE = 0.8;

export const PADS: readonly PadDef[] = [
  { name: 'Spawn top', shape: { kind: 'circle', x: SPAWN_RISE.x, z: SPAWN_RISE.z, radius: SPAWN_RISE.top }, blend: 12, rise: 0.3 },
  {
    name: 'Dorp yard',
    shape: { kind: 'rectangle', x: DORP_YARD.x, z: DORP_YARD.z, width: DORP_YARD.width, depth: DORP_YARD.depth },
    blend: 30,
    rise: DORP_YARD.rise,
  },
  { name: 'Tafelkop overlook', shape: { kind: 'circle', x: 2370, z: 600, radius: 12 }, blend: 10, rise: 0.3 },
  // Where the Koppie Klim ends: a place to stop and look south over the dam to the pan (design §8).
  { name: 'Koppie saddle', shape: { kind: 'circle', x: 1570, z: 650, radius: 8 }, blend: 8, rise: 0.2 },
  // The pan start line (M5) has no pad: it lies on Die Myl where the road leans down to the salt,
  // and a level pad there would put a sharp crest in the flat-out line. The graded road is its flat.
];

// ── authored jumps (design §9 with the real-gravity numbers of plan v3 S2-1) ─────────
/** J1 "Eerste Bult": a crest in the spine's graded line, circular over the top. */
export const EERSTE_BULT = { x: 1560, z: 1800, height: 1.5, radius: 100, maxGrade: 0.07, landingLength: 100 } as const;

/** J4: six swells across the lane at the west edge of the dunes. */
export const NURSERY_WHOOPS = {
  lane: WIT_DUINE.whoops,
  count: 6,
  height: 3,
  spacing: 60,
  firstCrestX: 2190,
  /** Below 1 this flattens the tops: 0.9 gives a crest radius of about 67 m. */
  topExponent: 0.9,
  /** Metres over which the lane blends into the dunes beside it. */
  laneFeather: 20,
  /** The dunes around the lane are this much lower, fading over `nurseryReach` metres. */
  nurseryLowering: 0.8,
  nurseryReach: 120,
} as const;

/** J6 "Die Sprong": a kicker on the inside bank of the river bend, a landing on the far bank. */
export const DIE_SPRONG = {
  x: 740,
  z: 1470,
  rampSlope: 0.25,
  rampHeight: 3,
  gap: 30,
  /** The landing stands this much lower than the lip. */
  farBankDrop: 1,
  landingLength: 40,
  halfWidth: 5,
} as const;

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
