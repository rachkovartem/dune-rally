// src/world/propIds.ts
// The ids of the Poly Haven prop models. Pure data, so the prop placement and the server can use
// them without loading three.js.

export const POLY_PROP_IDS = [
  'namaqualand_boulder_02',
  'namaqualand_boulder_03',
  'namaqualand_boulder_05',
  'dead_tree_trunk_02',
  'namaqualand_stones_01',
  'wild_rooibos_bush',
] as const;

export type PolyPropId = (typeof POLY_PROP_IDS)[number];

export const BOULDER_IDS: readonly PolyPropId[] = ['namaqualand_boulder_02', 'namaqualand_boulder_03', 'namaqualand_boulder_05'];
