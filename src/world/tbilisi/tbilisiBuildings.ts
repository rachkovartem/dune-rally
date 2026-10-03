// src/world/tbilisi/tbilisiBuildings.ts
// Solid physical collider boxes for Metekhi Bridge barriers, Meidan street buildings, and Old Tbilisi quarters.
import type { BuildingBox } from '../worldDef';

export interface TbilisiBuilding extends BuildingBox {
  id: string;
  name: string;
  roofKind: 'tiles' | 'metal' | 'planks';
  stories: 1 | 2;
  hasPorch?: boolean;
  customRender: true;
}

export const TBILISI_BUILDINGS: readonly TbilisiBuilding[] = [
  // ── Metekhi Bridge Solid Safety Barrier Colliders ───────────────────
  // Prevents cars from accidentally driving off the bridge into the river gorge
  {
    id: 'bridge_barrier_west',
    name: 'Metekhi Bridge West Stone Parapet',
    x: 1889.5, z: 550, w: 1.4, d: 122, h: 3.5, yaw: 0,
    roofKind: 'metal', stories: 1, customRender: true,
  },
  {
    id: 'bridge_barrier_east',
    name: 'Metekhi Bridge East Balustrade',
    x: 1910.5, z: 550, w: 1.4, d: 122, h: 3.5, yaw: 0,
    roofKind: 'metal', stories: 1, customRender: true,
  },

  // ── Gorgasali Square (Meidan) West Streetfront Buildings ───────────
  {
    id: 'meidan_west_1',
    name: 'Meidan Merchant Mansion',
    x: 1878, z: 475, w: 14, d: 20, h: 10.0, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'meidan_west_2',
    name: 'Old Town Heritage Hotel',
    x: 1875, z: 450, w: 16, d: 22, h: 12.0, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'meidan_west_3',
    name: 'Carpet & Spice Bazaar Arcade',
    x: 1872, z: 425, w: 18, d: 22, h: 12.0, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },

  // ── Gorgasali Square (Meidan) East Streetfront Buildings ───────────
  {
    id: 'meidan_east_1',
    name: 'Meidan Riverfront Cafe',
    x: 1922, z: 475, w: 14, d: 20, h: 10.0, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'meidan_east_2',
    name: 'Terrace Restaurant & Balconies',
    x: 1925, z: 450, w: 16, d: 22, h: 12.0, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'meidan_st_george',
    name: 'St. George Quarter Church',
    x: 1930, z: 425, w: 16, d: 18, h: 16.0, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: false, customRender: true,
  },

  // ── Metekhi Cliffside Mansions (East Bank) ──────────────────────────
  {
    id: 'cliff_mansion_1',
    name: 'Metekhi Cliff Residence',
    x: 1955, z: 510, w: 14, d: 12, h: 10.0, yaw: 0.2,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
  {
    id: 'cliff_mansion_2',
    name: 'Old Tbilisi Panorama House',
    x: 1960, z: 560, w: 14, d: 12, h: 10.0, yaw: -0.2,
    roofKind: 'tiles', stories: 2, hasPorch: true, customRender: true,
  },
];
