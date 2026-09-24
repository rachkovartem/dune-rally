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

// Two sizes of the same rock image, multiplied, so its tile edges do not line up into a grid.
const ROCK_TILE_METRES = 13;
const ROCK_DETAIL_TILE_METRES = 47;
// The image is a scan atlas; a blurrier mip hides the outlines of its islands, which otherwise
// tile into a honeycomb across a big face.
const ROCK_MIP_BIAS = 1.5;

/** Projects the rock image along all three axes, so a steep cliff face is not smeared the way the
 * planar sand UV is, and mixes it over the sand by the mesh's `rockWeight`. */
function addRockLayer(material: THREE.MeshStandardMaterial, rock: THREE.Texture): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rockMap = { value: rock };
    shader.vertexShader = 'attribute float rockWeight;\nvarying float vRockWeight;\nvarying vec3 vRockWorld;\nvarying vec3 vRockNormal;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vRockWeight = rockWeight;
        vRockWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRockNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = `#define ROCK_MIP_BIAS ${ROCK_MIP_BIAS.toFixed(1)}\n` + 'uniform sampler2D rockMap;\nvarying float vRockWeight;\nvarying vec3 vRockWorld;\nvarying vec3 vRockNormal;\n'
      + `vec3 rockSample(vec3 world, vec3 blend, float tile) {
          vec3 p = world / tile;
          return texture(rockMap, p.zy, ROCK_MIP_BIAS).rgb * blend.x + texture(rockMap, p.xz, ROCK_MIP_BIAS).rgb * blend.y + texture(rockMap, p.xy, ROCK_MIP_BIAS).rgb * blend.z;
        }\n`
      + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vRockWeight > 0.001) {
            vec3 rockBlend = pow(abs(normalize(vRockNormal)), vec3(4.0));
            rockBlend /= dot(rockBlend, vec3(1.0));
            vec3 rock = rockSample(vRockWorld, rockBlend, ${ROCK_TILE_METRES.toFixed(1)}) * (0.55 + 0.9 * rockSample(vRockWorld.zyx, rockBlend.zyx, ${ROCK_DETAIL_TILE_METRES.toFixed(1)}));
            diffuseColor.rgb = mix(diffuseColor.rgb, rock, vRockWeight);
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mix(normal, nonPerturbedNormal, vRockWeight * 0.8));`);
  };
  material.customProgramCacheKey = () => 'terrain-rock-layer';
}

/** Shared terrain material; the mesh supplies a planar `uv`, a per-vertex `color` tint and a
 * `rockWeight` for the rock layer. */
export function createTerrainMaterial(sand: TerrainTextureSet, rock: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
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
  addRockLayer(material, rock);
  return material;
}
