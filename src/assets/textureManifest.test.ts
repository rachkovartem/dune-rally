// src/assets/textureManifest.test.ts
import { describe, it, expect } from 'vitest';
import { TEXTURE_SETS, textureSetForCover, PROP_TEXTURE_SETS } from './textureManifest';
import { layerIndexFor, terrainLayerOrder } from '../render/terrainTextures';
import { COVER_IDS } from '../world/biome';

const downloadedIds = new Set(TEXTURE_SETS.map((set) => set.id));

describe('texture manifest (R36, R37)', () => {
  it.each(COVER_IDS)('backs the "%s" cover with a texture set that is downloaded', (cover) => {
    expect(downloadedIds.has(textureSetForCover(cover))).toBe(true);
  });

  it('backs every prop kind with a texture set that is downloaded', () => {
    for (const id of Object.values(PROP_TEXTURE_SETS)) expect(downloadedIds.has(id)).toBe(true);
  });

  it('lists each set once, from ambientCG, with a licence', () => {
    expect(downloadedIds.size).toBe(TEXTURE_SETS.length);
    for (const set of TEXTURE_SETS) {
      expect(set.url).toBe(`https://ambientcg.com/get?file=${set.id}_1K-JPG.zip`);
      expect(set.licence.trim()).not.toBe('');
    }
  });
});

describe('terrain layer order (R16)', () => {
  it('gives every terrain layer its own index', () => {
    const indices = terrainLayerOrder().map(layerIndexFor);
    expect(new Set(indices).size).toBe(indices.length);
    indices.forEach((index, position) => expect(index).toBe(position));
  });

  it.each(COVER_IDS)('has a layer for the texture set of the "%s" cover', (cover) => {
    expect(() => layerIndexFor(textureSetForCover(cover))).not.toThrow();
  });

  it('throws for a set the terrain material never loaded, instead of painting layer 0', () => {
    expect(() => layerIndexFor('Planks037A')).toThrow('is not one of the terrain\'s loaded texture sets');
  });
});
