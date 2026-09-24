// src/render/terrainMaterial.ts
// One shared PBR terrain material for every streamed chunk (rule: no per-chunk material). Two
// cover layers are sampled per fragment from three small DataArrayTextures (color/normal/ARM),
// triplanar-projected so steep faces (rock, cliffs) don't stretch, blended by the per-vertex
// `coverWeight` the mesh builder writes, then tinted per cover so texture sets shared by several
// covers (see terrainTextures.ts) still read as visually distinct ground.
import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  attribute, texture, mix, float, int, vec3, positionWorld, normalWorld, cameraPosition,
  reflect, normalize, dot, pow, saturate, smoothstep, distance, hash,
} from 'three/tsl';
import { layerIndexFor } from './terrainTextures';

const BASE_SCALE = 0.16; // world units -> texture repeats
const DETAIL_SCALE = BASE_SCALE * 0.23; // second, coarser tiling for anti-tiling blend
const RIPPLE_SCALE = 1.6; // sand-only fine ripple normal, tighter tiling than the base sand map
const SAND_LAYER_INDEX = layerIndexFor('Ground054');

export interface TerrainTextureArrays {
  color: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  arm: THREE.DataArrayTexture;
}

/**
 * Packs `images.length` same-size 2D images into one `DataArrayTexture` layer per image, in the
 * order given — callers pass images in `terrainLayerOrder()` order so a vertex's `coverA`/`coverB`
 * layer index lines up with the right texture set on every one of the three maps.
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

/** Triplanar-samples one layer of a DataArrayTexture, blended by how much the surface normal
 * faces each world axis — steep faces (rock, cliffs) read correctly instead of stretching. */
function sampleLayerTriplanar(map: THREE.DataArrayTexture, layerIndex: Node, scale: number) {
  const blend = normalWorld.abs().normalize();
  const blendNorm = blend.div(blend.dot(vec3(1, 1, 1)));

  const sampleX = texture(map, positionWorld.yz.mul(scale)).depth(layerIndex);
  const sampleY = texture(map, positionWorld.zx.mul(scale)).depth(layerIndex);
  const sampleZ = texture(map, positionWorld.xy.mul(scale)).depth(layerIndex);

  return sampleX.mul(blendNorm.x).add(sampleY.mul(blendNorm.y)).add(sampleZ.mul(blendNorm.z));
}

/** Shared single-instance terrain material: two-cover triplanar PBR blend, anti-tiling, sand
 * wind-ripple normal detail and a subtle sun-facing sparkle on sand. */
export function createTerrainMaterial(arrays: TerrainTextureArrays, sunDirection: THREE.Vector3): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });

  const coverA = int(attribute('coverA', 'float'));
  const coverB = int(attribute('coverB', 'float'));
  const coverWeight = attribute('coverWeight', 'float');
  const tintA = attribute('tintA', 'vec3');
  const tintB = attribute('tintB', 'vec3');

  const colorA = sampleLayerTriplanar(arrays.color, coverA, BASE_SCALE).mul(tintA);
  const colorB = sampleLayerTriplanar(arrays.color, coverB, BASE_SCALE).mul(tintB);
  const colorDetailA = sampleLayerTriplanar(arrays.color, coverA, DETAIL_SCALE).mul(tintA);

  // Anti-tiling: blend the dominant layer's own texture at a second, coarser scale using a
  // low-frequency world-space hash so a long straight drive never shows an obvious repeat.
  const antiTileFactor = hash(positionWorld.x.mul(0.013).add(positionWorld.z.mul(0.019)));
  const colorAAntiTiled = mix(colorA, colorDetailA, antiTileFactor.mul(0.4));

  const armA = sampleLayerTriplanar(arrays.arm, coverA, BASE_SCALE);
  const armB = sampleLayerTriplanar(arrays.arm, coverB, BASE_SCALE);
  const blendedColor = mix(colorAAntiTiled, colorB, coverWeight);
  const blendedArm = mix(armA, armB, coverWeight);

  // Sand wind ripples: the sand set's own normal map read as a fine grain and folded into the
  // albedo rather than the lighting normal. A triplanar blend mixes three tangent-space samples
  // taken in three different local frames; used directly as normalNode without a per-axis TBN
  // rotation (not implemented this pass) it shades as if the ground faced sideways — verified on
  // screen, see the report's Notes. The colour-grain version is a safe, visible stand-in.
  const distanceToCamera = distance(positionWorld, cameraPosition);
  const rippleFade = float(1.0).sub(smoothstep(40, 90, distanceToCamera));
  const isSand = coverA.equal(int(SAND_LAYER_INDEX)).and(coverWeight.lessThan(0.5));
  const rippleGrain = sampleLayerTriplanar(arrays.normal, int(SAND_LAYER_INDEX), RIPPLE_SCALE).r;
  const rippleWeight = rippleFade.mul(saturate(isSand.select(float(0.5), float(0))));
  const rippleShade = mix(float(1), rippleGrain.mul(1.6).sub(0.3), rippleWeight);

  material.colorNode = blendedColor.mul(rippleShade);
  material.aoNode = blendedArm.r;
  material.roughnessNode = blendedArm.g.mul(0.9).add(0.1);

  // Subtle sun-facing sparkle on sunlit sand — a small hash-masked specular boost, not a texture.
  const sunDirectionNode = vec3(sunDirection.x, sunDirection.y, sunDirection.z);
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const sparkleSeed = positionWorld.x.mul(12.9898).add(positionWorld.z.mul(37.719));
  const sparkleGlint = pow(saturate(dot(reflect(viewDirection.negate(), normalWorld), sunDirectionNode)), 220);
  const sparkleMask = hash(sparkleSeed).mul(saturate(isSand.select(float(1), float(0))));
  material.emissiveNode = vec3(1, 0.96, 0.85).mul(sparkleGlint).mul(sparkleMask).mul(0.35);

  return material;
}
