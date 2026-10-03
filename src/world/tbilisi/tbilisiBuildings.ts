// src/world/tbilisi/tbilisiBuildings.ts
// Architectural building definitions in Old Tbilisi and around Europe Square.
import type { BuildingBox } from '../worldDef';

export interface TbilisiBuilding extends BuildingBox {
  id: string;
  name: string;
  roofKind: 'tiles' | 'metal' | 'planks';
  stories: 1 | 2;
  hasPorch?: boolean;
  customRender: true;
}

/**
 * Traditional Old Tbilisi houses along the riverbanks, Metekhi cliff, Meidan, and Wine Ascent.
 * All have customRender: true so they are rendered with authentic photographic Georgian textures
 * in tbilisiLandmarks.ts, while providing precise physics collision boxes.
 */
export const TBILISI_BUILDINGS: readonly TbilisiBuilding[] = [
  // ── Metekhi Cliffside (historic houses clinging to the gorge cliff) ──
  {
    id: 'cliff_house_1',
    name: 'Metekhi Cliff Residence',
    x: 1855, z: 480, w: 12, d: 10, h: 9.0, yaw: 0.1,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'cliff_house_2',
    name: 'Old Tbilisi Panorama House',
    x: 1895, z: 465, w: 14, d: 11, h: 9.5, yaw: -0.2,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'cliff_house_3',
    name: 'Metekhi Overlook Villa',
    x: 1860, z: 545, w: 13, d: 10, h: 8.5, yaw: 0.35,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },

  // ── West Bank / Gorgasali Square (Meidan) across the bridge ─────────
  {
    id: 'meidan_cafe_1',
    name: 'Meidan Square Cafe',
    x: 1835, z: 575, w: 14, d: 12, h: 8.0, yaw: -0.6,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'meidan_hotel',
    name: 'Old Town Heritage Hotel',
    x: 1845, z: 525, w: 16, d: 12, h: 9.0, yaw: -0.4,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'meidan_bazaar',
    name: 'Carpet & Spice Bazaar',
    x: 1820, z: 545, w: 15, d: 14, h: 8.5, yaw: -0.5,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },

  // ── Wine Ascent (Ghvini Agmarti) climbing east from Europe Square ───
  {
    id: 'wine_ascent_1',
    name: 'Old Tbilisi Wine House',
    x: 1980, z: 660, w: 14, d: 11, h: 8.0, yaw: 0.4,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'wine_ascent_2',
    name: 'Carved Balcony Inn',
    x: 1995, z: 630, w: 15, d: 12, h: 8.5, yaw: 0.35,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'avlabari_house_1',
    name: 'Avlabari Terrace House',
    x: 1970, z: 570, w: 14, d: 10, h: 8.0, yaw: -0.1,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },

  // ── Rike Park Cable Car Station (north of Europe Square) ───────────
  {
    id: 'cable_car_station',
    name: 'Rike Cable Car Lower Station',
    x: 1945, z: 490, w: 16, d: 14, h: 6.5, yaw: 0.0,
    roofKind: 'metal', stories: 1, hasPorch: false, customRender: true,
  },
];
