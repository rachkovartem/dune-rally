// src/assets/textureManifest.ts
// Pure manifest of the PBR texture sets this stage adds: which ambientCG set backs each ground
// cover and each prop kind, and where to download it from. Read by scripts/fetch-textures.ts
// (Node) and by the terrain/prop material code at load time; no three.js import, no DOM.

import type { Cover } from '../world/biome';

export type TextureSetId =
  | 'Ground054'
  | 'Ground097'
  | 'Ground110'
  | 'Gravel043'
  | 'Rock064'
  | 'Road007'
  | 'Bark014'
  | 'Plaster001'
  | 'RoofingTiles013A'
  | 'Metal046B'
  | 'Planks037A';

export interface TextureSetDef {
  id: TextureSetId;
  source: 'ambientcg';
  url: string;
  licence: string;
  displayName: string;
}

function ambientCgUrl(id: TextureSetId): string {
  return `https://ambientcg.com/get?file=${id}_1K-JPG.zip`;
}

function ambientCgSet(id: TextureSetId, displayName: string): TextureSetDef {
  return { id, source: 'ambientcg', url: ambientCgUrl(id), licence: 'CC0 1.0', displayName };
}

/** Every texture set this stage downloads (terrain covers + shared prop materials). Ids verified live against ambientCG on 2026-09-24. */
export const TEXTURE_SETS: TextureSetDef[] = [
  ambientCgSet('Ground054', 'Rippled sand'),
  ambientCgSet('Ground097', 'Dry grass ground'),
  ambientCgSet('Ground110', 'Packed dirt'),
  ambientCgSet('Gravel043', 'Gravel'),
  ambientCgSet('Rock064', 'Rock'),
  ambientCgSet('Road007', 'Paved road'),
  ambientCgSet('Bark014', 'Tree bark'),
  ambientCgSet('Plaster001', 'Stucco plaster'),
  ambientCgSet('RoofingTiles013A', 'Roof tiles'),
  ambientCgSet('Metal046B', 'Brushed metal'),
  ambientCgSet('Planks037A', 'Wood planks'),
];

/** Cover -> texture set. Rare covers reuse a real set with a shader tint instead of a separate
 * download. `'water'` is never returned by `coverAt` (the lake bed is `'mud'`) — mapped here only
 * so the lookup stays total over the `Cover` type. */
const COVER_TEXTURE_SET: Record<Cover, TextureSetId> = {
  sand: 'Ground054',
  dryGrass: 'Ground097',
  dirt: 'Ground110',
  gravel: 'Gravel043',
  rock: 'Rock064',
  road: 'Road007',
  beach: 'Ground054',
  mud: 'Ground110',
  grass: 'Ground097',
  forest: 'Ground097',
  snow: 'Ground054',
  water: 'Ground054',
  // The white crust is the sand set under a surface tint (plan v3 S2-3), not a download of its own.
  salt: 'Ground054',
};

export function textureSetForCover(cover: Cover): TextureSetId {
  return COVER_TEXTURE_SET[cover];
}

export type PropKind = 'rock' | 'bark' | 'stucco' | 'roof' | 'metal' | 'wood';

/** Shared texture set per prop kind (scatter.ts materials, building walls/roofs). */
export const PROP_TEXTURE_SETS: Record<PropKind, TextureSetId> = {
  rock: 'Rock064',
  bark: 'Bark014',
  stucco: 'Plaster001',
  roof: 'RoofingTiles013A',
  metal: 'Metal046B',
  wood: 'Planks037A',
};
