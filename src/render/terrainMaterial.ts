// src/render/terrainMaterial.ts
// One shared terrain material for every streamed chunk (rule: no per-chunk material). Step A
// version: the sand set on every cover, shaded apart by the mesh's per-vertex colour. The
// per-layer splat blend replaces it in Step B.
import * as THREE from 'three';
import { SURFACE_TINT_GLSL } from './surfaceTints';
import { BOULDER_CELL_METRES, ROCK_LOOK_GLSL } from './rockLook';

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

// How far the boulder domes tilt the normal at their rim, and how dark the cracks between them get.
const BOULDER_BULGE = 0.9;
const CRACK_SHADE = 0.35;
/** Metres from the camera over which the boulder shading fades out. */
const BOULDER_FADE = { from: 450, to: 650 };

/** Projects the rock image along all three axes, so a steep cliff face is not smeared the way the
 * planar sand UV is, and mixes it over the sand by the mesh's `rockWeight`. The face is drawn as
 * packed rounded boulders with sand in the cracks near its edge, so a band never reads as one flat
 * wall. The surface tint comes after the rock mix, so the dolerite ridge darkens its rock faces too. */
function addRockLayer(material: THREE.MeshStandardMaterial, rock: THREE.Texture): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rockMap = { value: rock };
    shader.vertexShader = 'attribute float rockWeight;\nvarying float vRockWeight;\nvarying vec3 vRockWorld;\nvarying vec3 vRockNormal;\n'
      + 'attribute vec4 surfaceTint;\nattribute vec2 surfaceDetail;\nvarying vec4 vSurfaceTint;\nvarying vec2 vSurfaceDetail;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vSurfaceTint = surfaceTint;
        vSurfaceDetail = surfaceDetail;
        vRockWeight = rockWeight;
        vRockWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRockNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = `#define ROCK_MIP_BIAS ${ROCK_MIP_BIAS.toFixed(1)}\n` + 'uniform sampler2D rockMap;\nvarying float vRockWeight;\nvarying vec3 vRockWorld;\nvarying vec3 vRockNormal;\n'
      + 'varying vec4 vSurfaceTint;\nvarying vec2 vSurfaceDetail;\nfloat rockCover;\nvec3 rockWorldNormal;\n' + SURFACE_TINT_GLSL + ROCK_LOOK_GLSL
      + `vec3 rockSample(vec3 world, vec3 blend, float tile) {
          vec3 p = world / tile;
          return texture(rockMap, p.zy, ROCK_MIP_BIAS).rgb * blend.x + texture(rockMap, p.xz, ROCK_MIP_BIAS).rgb * blend.y + texture(rockMap, p.xy, ROCK_MIP_BIAS).rgb * blend.z;
        }\n`
      + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          rockCover = 0.0;
          rockWorldNormal = normalize(vRockNormal);
          if (vRockWeight > 0.001) {
            vec3 rockBlend = pow(abs(rockWorldNormal), vec3(4.0));
            rockBlend /= dot(rockBlend, vec3(1.0));
            vec3 rock = rockSample(vRockWorld, rockBlend, ${ROCK_TILE_METRES.toFixed(1)}) * (0.55 + 0.9 * rockSample(vRockWorld.zyx, rockBlend.zyx, ${ROCK_DETAIL_TILE_METRES.toFixed(1)}));
            float crack = 1.0;
            float cellTone = 0.5;
            vec3 fromCentre = vec3(0.0);
            // The boulders are shading detail: past this distance they are a few pixels and cost the most screen.
            float boulderFade = 1.0 - smoothstep(${BOULDER_FADE.from.toFixed(1)}, ${BOULDER_FADE.to.toFixed(1)}, length(vViewPosition));
            if (boulderFade > 0.0) {
              vec3 cellSize = vec3(${BOULDER_CELL_METRES.across.toFixed(1)}, ${BOULDER_CELL_METRES.up.toFixed(1)}, ${BOULDER_CELL_METRES.across.toFixed(1)});
              // A warp bends the cell rows, so the boulders do not line up like cobbles.
              vec3 warped = vRockWorld + vec3(rockNoise(vRockWorld * 0.09) - 0.5, rockNoise(vRockWorld * 0.07 + 11.0) - 0.5, 0.0).xyx * vec3(6.0, 3.0, -6.0);
              vec4 cells = boulderCells(warped / cellSize, cellTone);
              fromCentre = (cells.xyz - rockWorldNormal * dot(cells.xyz, rockWorldNormal)) * boulderFade;
              // Some joints are deep dark gaps, others close up, as between the stacked boulders of a real koppie.
              float gap = smoothstep(0.3, 0.7, rockNoise(warped * 0.21 + 5.0));
              crack = mix(1.0, smoothstep(0.0, mix(0.03, 0.16, gap), cells.w), mix(0.3, 1.0, gap) * boulderFade);
              cellTone = mix(0.5, cellTone, boulderFade);
            }
            // The edge wanders with noise and sand fills the cracks first, so the rock fades into the talus.
            float edge = vRockWeight + (rockNoise(vRockWorld * 0.18) - 0.5) * 0.6 - (1.0 - crack) * 0.35 * (1.0 - vRockWeight);
            rockCover = smoothstep(0.3, 0.6, edge);
            rockWorldNormal = normalize(rockWorldNormal + fromCentre * ${BOULDER_BULGE.toFixed(2)} * rockCover);
            rock = rockLook(rock, vRockWorld, rockWorldNormal) * mix(${CRACK_SHADE.toFixed(2)}, 1.0, crack) * (0.85 + 0.3 * cellTone);
            diffuseColor.rgb = mix(diffuseColor.rgb, rock, rockCover);
          }
          diffuseColor.rgb = applySurfaceTint(diffuseColor.rgb, vSurfaceTint);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor *= vSurfaceDetail.y;
          roughnessFactor = mix(roughnessFactor, 0.92, rockCover);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(rockWorldNormal, 0.0)).xyz), rockCover));
          normal = normalize(mix(nonPerturbedNormal, normal, vSurfaceDetail.x));`);
  };
  material.customProgramCacheKey = () => 'terrain-rock-boulders-surface-tint';
}

/** Shared terrain material; the mesh supplies a planar `uv`, a per-vertex `color` tint, a
 * `rockWeight` for the rock layer and the `surfaceTint` / `surfaceDetail` of the surface tint. */
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
