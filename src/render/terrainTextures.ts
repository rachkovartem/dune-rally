// src/render/terrainTextures.ts
// The fixed layer order of the terrain's shared DataArrayTexture. Pure, no three.js import — the
// mesh builder and the material builder both read it so a vertex's layer index always points at
// the same texture set. Only the covers that actually reach the ground (see
// `textureManifest.ts`'s `textureSetForCover`) get their own layer; rare covers share a layer and
// are told apart by a per-vertex tint instead.
import type { TextureSetId } from '../assets/textureManifest';

const TERRAIN_TEXTURE_IDS: readonly TextureSetId[] = [
  'Ground054', // sand / beach / snow (tinted)
  'Ground097', // dryGrass / grass / forest (tinted)
  'Ground110', // dirt / mud (tinted, darker)
  'Gravel043', // gravel
  'Rock064', // rock
  'Road007', // road
];

/** The ordered list of texture set ids sampled by the terrain material's array textures. */
export function terrainLayerOrder(): readonly TextureSetId[] {
  return TERRAIN_TEXTURE_IDS;
}

/** Index of a texture set within the terrain's array textures. Throws on an id the terrain
 * material never loaded — a silent fallback to layer 0 would paint the wrong ground texture. */
export function layerIndexFor(id: TextureSetId): number {
  const index = TERRAIN_TEXTURE_IDS.indexOf(id);
  if (index === -1) {
    throw new Error(`layerIndexFor: "${id}" is not one of the terrain's loaded texture sets.`);
  }
  return index;
}
