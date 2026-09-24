// src/render/terrainMaterial.ts
// One shared terrain material for every streamed chunk (rule: no per-chunk material). Step A
// version: the sand set on every cover, shaded apart by the mesh's per-vertex colour. The
// per-layer splat blend replaces it in Step B.
import * as THREE from 'three';

export interface TerrainTextureSet {
  color: THREE.Texture;
  normal: THREE.Texture;
  /** ambientCG ARM packing: ambient occlusion, roughness, metalness in R, G, B. */
  arm: THREE.Texture;
}

/**
 * Packs `images.length` same-size 2D images into one `DataArrayTexture` layer per image, in the
 * order given. Not used by the Step A material; the Step B splat material samples these layers
 * in `terrainLayerOrder()` order.
 */
export function buildArrayTexture(images: readonly HTMLImageElement[], colorSpace: THREE.ColorSpace): THREE.DataArrayTexture {
  const first = images[0];
  if (!first || first.width === 0) throw new Error('buildArrayTexture: no images to pack.');
  const size = first.width;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('buildArrayTexture: 2D canvas context unavailable.');

  const data = new Uint8Array(size * size * 4 * images.length);
  for (let layer = 0; layer < images.length; layer++) {
    context.clearRect(0, 0, size, size);
    context.drawImage(images[layer], 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    data.set(pixels, layer * size * size * 4);
  }

  const arrayTexture = new THREE.DataArrayTexture(data, size, size, images.length);
  arrayTexture.format = THREE.RGBAFormat;
  arrayTexture.type = THREE.UnsignedByteType;
  arrayTexture.colorSpace = colorSpace;
  arrayTexture.wrapS = THREE.RepeatWrapping;
  arrayTexture.wrapT = THREE.RepeatWrapping;
  arrayTexture.needsUpdate = true;
  return arrayTexture;
}

/** Shared terrain material; the mesh supplies a planar `uv` and a per-vertex `color` tint. */
export function createTerrainMaterial(sand: TerrainTextureSet): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: sand.color,
    normalMap: sand.normal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    aoMap: sand.arm,
    roughnessMap: sand.arm,
    metalnessMap: sand.arm,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
}
