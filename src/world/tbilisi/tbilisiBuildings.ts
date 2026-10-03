// src/world/tbilisi/tbilisiBuildings.ts
// Architectural building definitions in Old Tbilisi and around Europe Square.
import type { BuildingBox } from '../worldDef';

export interface TbilisiBuilding extends BuildingBox {
  id: string;
  name: string;
  roofKind: 'tiles' | 'metal' | 'planks';
  stories: 1 | 2;
  hasPorch?: boolean;
}

/**
 * Traditional Old Tbilisi houses along the riverbanks, Metekhi cliff, and Wine Ascent.
 */
export const TBILISI_BUILDINGS: readonly TbilisiBuilding[] = [
  // ── Wine Ascent (Ghvini Agmarti) north-east of Europe Square ────────
  {
    id: 'wine_ascent_1',
    name: 'Old Tbilisi Wine House',
    x: 2038, z: 480, w: 14, d: 11, h: 7.5, yaw: 0.35,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'wine_ascent_2',
    name: 'Carved Balcony Inn',
    x: 2060, z: 465, w: 16, d: 12, h: 8.0, yaw: 0.35,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'wine_ascent_3',
    name: 'Avlabari Terrace House',
    x: 2085, z: 450, w: 15, d: 10, h: 7.2, yaw: 0.40,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },

  // ── Metekhi Cliffside (houses lining the cliff above the river) ──────
  {
    id: 'cliff_house_1',
    name: 'Metekhi Cliff Residence',
    x: 2025, z: 565, w: 13, d: 11, h: 7.5, yaw: -0.2,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'cliff_house_2',
    name: 'Old Tbilisi Panorama House',
    x: 2040, z: 595, w: 15, d: 12, h: 8.5, yaw: 0.1,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'cliff_house_3',
    name: 'Stone Arch Mansion',
    x: 2028, z: 625, w: 16, d: 13, h: 8.0, yaw: 0.25,
    roofKind: 'tiles', stories: 2, hasPorch: false,
  },

  // ── West Bank / Gorgasali Square (Meidan) approach ──────────────────
  {
    id: 'meidan_cafe_1',
    name: 'Meidan Square Cafe',
    x: 1890, z: 600, w: 14, d: 12, h: 7.5, yaw: -0.6,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'meidan_shop_1',
    name: 'Carpet & Spice Bazaar',
    x: 1872, z: 585, w: 16, d: 14, h: 8.2, yaw: -0.6,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'meidan_hotel',
    name: 'Old Town Heritage Hotel',
    x: 1885, z: 562, w: 18, d: 14, h: 9.0, yaw: -0.5,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'baratashvili_house_1',
    name: 'Right Embankment Villa',
    x: 1835, z: 440, w: 15, d: 12, h: 7.8, yaw: -0.4,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },

  // ── Europe Square Perimeter Pavilions ───────────────────────────────
  {
    id: 'europe_sq_pavilion',
    name: 'Europe Square Information Center',
    x: 1975, z: 476, w: 12, d: 8, h: 4.8, yaw: 0.1,
    roofKind: 'metal', stories: 1, hasPorch: true,
  },
  {
    id: 'cable_car_station',
    name: 'Rike Cable Car Lower Station',
    x: 1982, z: 450, w: 16, d: 14, h: 6.5, yaw: 0.0,
    roofKind: 'metal', stories: 1, hasPorch: false,
  },
];
