// src/world/tbilisi/tbilisiDef.ts
// Geographic and architectural definitions of Tbilisi Europe Square, Metekhi, and the Kura River canyon.
import type { Point2 } from '../polyline';

export const TBILISI_CENTER = { x: 1950, z: 500 } as const;
export const TBILISI_RADIUS = 230;

/** Real-world orthophoto satellite coverage bounds (456.6m x 456.6m). */
export const TBILISI_ORTHO_BOUNDS = {
  minX: 1950 - 228.3,
  maxX: 1950 + 228.3,
  minZ: 500 - 228.3,
  maxZ: 500 + 228.3,
  width: 456.6,
  height: 456.6,
} as const;

/** Europe Square (Площадь Европы) circular roundabout. */
export const TBILISI_ROUNDABOUT = {
  center: { x: 1996, z: 508 },
  outerRadius: 26,
  innerRadius: 13,
  roadElevation: 14.5,
} as const;

/** Metekhi Bridge (Мост Метехи) spanning across the Kura from Europe Square to Meidan. */
export const TBILISI_METEKHI_BRIDGE = {
  start: { x: 1975, z: 525 },
  end: { x: 1905, z: 585 },
  width: 16,
  deckElevation: 14.5,
  pierCount: 2,
} as const;

/** The rocky Metekhi Cliff (Скала Метехи) jutting into the Kura river gorge. */
export const TBILISI_METEKHI_CLIFF = {
  center: { x: 2005, z: 595 },
  radius: 38,
  topElevation: 26.5,
  wallSharpness: 0.85,
} as const;

/** Metekhi Church (Церковь Метехи) atop the cliff. */
export const TBILISI_METEKHI_CHURCH = {
  pos: { x: 2002, y: 26.5, z: 590 },
  yaw: -Math.PI * 0.25,
} as const;

/** Monument to King Vakhtang Gorgasali (Памятник Вахтангу Горгасали) on the promontory. */
export const TBILISI_GORGASALI_STATUE = {
  pos: { x: 1982, y: 26.5, z: 578 },
  yaw: Math.PI * 0.7,
} as const;

/** Bridge of Peace (Мост Мира) glass pedestrian canopy bridge to the north. */
export const TBILISI_PEACE_BRIDGE = {
  start: { x: 1885, z: 340 },
  end: { x: 1825, z: 330 },
  width: 8,
  deckElevation: 13.5,
  canopyHeight: 9.0,
} as const;

/** Mtkvari (Kura) River centerline through the Tbilisi gorge. */
export const TBILISI_KURA_LINE: readonly Point2[] = [
  { x: 1740, z: 260 },
  { x: 1790, z: 330 },
  { x: 1860, z: 420 },
  { x: 1940, z: 530 },
  { x: 2010, z: 630 },
  { x: 2070, z: 720 },
];

export const TBILISI_KURA_RIVER = {
  halfWidth: 24,
  waterElevation: 3.5,
  bedElevation: 1.0,
  quayElevation: 14.2,
} as const;

/** Connecting highway from Europe Square east to the Ooslus road (1950, 820). */
export const TBILISI_HIGHWAY: readonly Point2[] = [
  { x: 2025, z: 508 },
  { x: 2020, z: 580 },
  { x: 2000, z: 660 },
  { x: 1970, z: 740 },
  { x: 1950, z: 820 },
];

export const TBILISI_HIGHWAY_WIDTH = 12;

/** Spawn point: directly on Europe Square roundabout, facing Metekhi Bridge & Church. */
export const TBILISI_SPAWN = {
  x: 1996,
  z: 508,
  yaw: Math.PI * 0.72,
} as const;

/** Check if coordinates fall within the active Tbilisi sector. */
export function inTbilisiSector(x: number, z: number): boolean {
  return Math.hypot(x - TBILISI_CENTER.x, z - TBILISI_CENTER.z) <= TBILISI_RADIUS;
}
