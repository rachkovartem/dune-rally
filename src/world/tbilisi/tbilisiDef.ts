// src/world/tbilisi/tbilisiDef.ts
// Geographic and architectural definitions of Tbilisi Metekhi Bridge, Meidan, Narikala Ridge, and Europe Square.
import type { Point2 } from '../polyline';

export const TBILISI_CENTER = { x: 1900, z: 520 } as const;
export const TBILISI_RADIUS = 260;

/** Real-world orthophoto satellite coverage bounds (456.6m x 456.6m). */
export const TBILISI_ORTHO_BOUNDS = {
  minX: 1900 - 228.3,
  maxX: 1900 + 228.3,
  minZ: 520 - 228.3,
  maxZ: 520 + 228.3,
  width: 456.6,
  height: 456.6,
} as const;

/**
 * Metekhi Bridge (Мост Метехи).
 * Spans North-South across the Kura gorge from Europe Square (South) to Gorgasali Square / Meidan (North).
 * Perfectly aligned with the North heading (yaw: Math.PI) so cars drive straight across looking at Old Tbilisi.
 */
export const TBILISI_METEKHI_BRIDGE = {
  start: { x: 1900, z: 610 },
  end: { x: 1900, z: 490 },
  width: 18.0,
  deckElevation: 14.50,
  pierCount: 2,
} as const;

/** Europe Square (Площадь Европы) circular roundabout at the South approach of the bridge. */
export const TBILISI_ROUNDABOUT = {
  center: { x: 1900, z: 645 },
  outerRadius: 28,
  innerRadius: 14,
  roadElevation: 14.50,
} as const;

/** Gorgasali Square (Мейдан) at the North bridgehead. */
export const TBILISI_MEIDAN = {
  center: { x: 1900, z: 470 },
  width: 45,
  length: 40,
  elevation: 14.50,
} as const;

/**
 * Sololaki / Narikala Mountain Ridge (Гора Нарикала).
 * Dramatic green Caucasian mountain rising behind Old Tbilisi from elevation 14.5m up to 86m.
 */
export const TBILISI_NARIKALA = {
  ridgeZ: 330,
  baseZ: 455,
  peakHeight: 86.0,
  statuePos: { x: 1865, y: 86.5, z: 325 },
} as const;

/** The rocky Metekhi Cliff (Скала Метехи) on the east riverbank overlooking the gorge. */
export const TBILISI_METEKHI_CLIFF = {
  center: { x: 1945, z: 535 },
  radius: 36,
  topElevation: 28.0,
  wallSharpness: 0.85,
} as const;

/** Metekhi Church (Церковь Метехи) atop the cliff. */
export const TBILISI_METEKHI_CHURCH = {
  pos: { x: 1950, y: 28.0, z: 530 },
  yaw: -Math.PI * 0.25,
} as const;

/** Monument to King Vakhtang Gorgasali (Памятник Вахтангу Горгасали) on the cliff promontory. */
export const TBILISI_GORGASALI_STATUE = {
  pos: { x: 1928, y: 28.0, z: 545 },
  yaw: Math.PI * 0.75,
} as const;

/** Mtkvari (Kura) River centerline flowing through the gorge beneath Metekhi Bridge. */
export const TBILISI_KURA_LINE: readonly Point2[] = [
  { x: 1810, z: 330 },
  { x: 1845, z: 410 },
  { x: 1875, z: 485 },
  { x: 1905, z: 555 },
  { x: 1935, z: 640 },
  { x: 1955, z: 730 },
];

export const TBILISI_KURA_RIVER = {
  halfWidth: 22,
  waterElevation: 3.5,
  bedElevation: 1.0,
  quayElevation: 14.2,
} as const;

/** Connecting highway from Europe Square South-East to the Ooslus desert road (1950, 820). */
export const TBILISI_HIGHWAY: readonly Point2[] = [
  { x: 1900, z: 673 },
  { x: 1915, z: 715 },
  { x: 1935, z: 760 },
  { x: 1950, z: 820 },
];

export const TBILISI_HIGHWAY_WIDTH = 12;

/**
 * Spawn point: on Metekhi Bridge, heading North (yaw: Math.PI).
 * Looking straight down the bridge towards Old Tbilisi, Meidan, and Narikala mountain.
 */
export const TBILISI_SPAWN = {
  x: 1900,
  z: 600,
  yaw: Math.PI,
} as const;

/** Check if coordinates fall within the active Tbilisi sector. */
export function inTbilisiSector(x: number, z: number): boolean {
  return Math.hypot(x - TBILISI_CENTER.x, z - TBILISI_CENTER.z) <= TBILISI_RADIUS;
}
