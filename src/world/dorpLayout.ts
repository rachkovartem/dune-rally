// src/world/dorpLayout.ts
// The Dorp: an authentic desert town settlement with 20 buildings, narrow alleys, courtyards, and plazas.
// Placed on the flat Dorp yard pad so all structures sit flush on the ground.
import type { BuildingBox } from './worldDef';

export interface DorpBuilding extends BuildingBox {
  id: string;
  name: string;
  roofKind: 'tiles' | 'metal' | 'planks';
  stories: 1 | 2;
  hasPorch?: boolean;
}

export const DORP_BUILDINGS: readonly DorpBuilding[] = [
  // ── Main Street (North side, z ≈ 1312–1315) ──────────────────────────
  {
    id: 'store',
    name: 'General Store',
    x: 1565, z: 1314, w: 14, d: 12, h: 6.5, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'saloon',
    name: 'Desert Hotel & Saloon',
    x: 1592, z: 1312, w: 16, d: 14, h: 7.5, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'townhall',
    name: 'Town Hall',
    x: 1620, z: 1314, w: 16, d: 12, h: 6.8, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: false,
  },
  {
    id: 'postoffice',
    name: 'Post Office',
    x: 1644, z: 1315, w: 12, d: 10, h: 5.2, yaw: 0,
    roofKind: 'tiles', stories: 1, hasPorch: false,
  },
  {
    id: 'supply',
    name: 'Supply Depot',
    x: 1668, z: 1314, w: 18, d: 12, h: 5.5, yaw: 0,
    roofKind: 'metal', stories: 1, hasPorch: false,
  },

  // ── Main Street (South side, z ≈ 1346–1348) ──────────────────────────
  {
    id: 'garage',
    name: 'Rally Garage & Workshop',
    x: 1565, z: 1346, w: 16, d: 12, h: 5.0, yaw: 0,
    roofKind: 'metal', stories: 1, hasPorch: true,
  },
  {
    id: 'blacksmith',
    name: 'Blacksmith',
    x: 1592, z: 1348, w: 14, d: 12, h: 5.2, yaw: 0,
    roofKind: 'metal', stories: 1, hasPorch: false,
  },
  {
    id: 'cafe',
    name: 'Dorp Cafe',
    x: 1620, z: 1346, w: 14, d: 12, h: 5.8, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: true,
  },
  {
    id: 'miningshop',
    name: 'Mining Outfitter',
    x: 1644, z: 1348, w: 12, d: 10, h: 5.0, yaw: 0,
    roofKind: 'tiles', stories: 1, hasPorch: false,
  },
  {
    id: 'warehouse',
    name: 'Freight Warehouse',
    x: 1670, z: 1346, w: 18, d: 12, h: 5.8, yaw: 0,
    roofKind: 'metal', stories: 1, hasPorch: false,
  },

  // ── North Alley (z ≈ 1276–1282) ──────────────────────────────────────
  {
    id: 'cottage1',
    name: 'North Cottage 1',
    x: 1555, z: 1280, w: 11, d: 10, h: 4.8, yaw: 0,
    roofKind: 'tiles', stories: 1, hasPorch: false,
  },
  {
    id: 'cottage2',
    name: 'North Cottage 2',
    x: 1580, z: 1278, w: 10, d: 10, h: 4.6, yaw: 0,
    roofKind: 'tiles', stories: 1, hasPorch: false,
  },
  {
    id: 'house3',
    name: 'Overlook Residence',
    x: 1612, z: 1276, w: 12, d: 11, h: 5.4, yaw: 0,
    roofKind: 'tiles', stories: 2, hasPorch: false,
  },
  {
    id: 'barn1',
    name: 'Barn & Stables',
    x: 1646, z: 1280, w: 16, d: 12, h: 6.2, yaw: 0,
    roofKind: 'planks', stories: 1, hasPorch: false,
  },
  {
    id: 'shed1',
    name: 'North Shed',
    x: 1675, z: 1280, w: 10, d: 8, h: 4.0, yaw: 0,
    roofKind: 'metal', stories: 1, hasPorch: false,
  },

  // ── South Alley (z ≈ 1380–1384) ──────────────────────────────────────
  {
    id: 'ranch1',
    name: 'South Ranch House',
    x: 1555, z: 1380, w: 12, d: 10, h: 5.0, yaw: 0,
    roofKind: 'tiles', stories: 1, hasPorch: true,
  },
  {
    id: 'shed2',
    name: 'South Workshop',
    x: 1585, z: 1382, w: 11, d: 9, h: 4.2, yaw: 0,
    roofKind: 'metal', stories: 1, hasPorch: false,
  },
  {
    id: 'house4',
    name: 'South Residence',
    x: 1616, z: 1384, w: 12, d: 10, h: 4.8, yaw: 0,
    roofKind: 'tiles', stories: 1, hasPorch: false,
  },
  {
    id: 'pumpstation',
    name: 'Water Pump Station',
    x: 1648, z: 1382, w: 12, d: 10, h: 4.5, yaw: 0,
    roofKind: 'metal', stories: 1, hasPorch: false,
  },
  {
    id: 'barn2',
    name: 'South Storage Barn',
    x: 1675, z: 1382, w: 11, d: 9, h: 4.2, yaw: 0,
    roofKind: 'planks', stories: 1, hasPorch: false,
  },
];
