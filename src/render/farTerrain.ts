// src/render/farTerrain.ts
// One coarse mesh of the whole map, so koppies, Tafelkop, the ridge and the border ranges stand on
// the horizon far past the streamed chunks. A per-chunk mask cuts it away wherever a near chunk is
// drawn, so the two never fight for the same pixel and nothing pops when a chunk arrives.
import * as THREE from 'three';
import { coverFromIndex, surfaceTintAt, type Cover } from '../world/biome';
import { CHUNK_SIZE, type ChunkCoord } from '../world/chunk';
import type { FarGrid } from '../world/farGrid';
import { coverTint, gridNormals, rockWeightAt } from './terrainMesh';
import { visualTerrainHeight } from './horizonShape';
import { surfaceTintFor, tintColor } from './surfaceTints';

export interface LinearColor {
  r: number;
  g: number;
  b: number;
}

/** First chunk index the near mask covers; the far grid reaches two chunks past each map edge. */
export const FAR_MASK_FIRST_CHUNK = -2;
/** Chunks per side of the near mask: indices −2 … 49. */
export const FAR_MASK_CHUNKS = 52;

/** The far ground colour of a cover: the mean sand colour times the near mesh's cover tint. */
export function farVertexColor(cover: Cover, sandMean: LinearColor): LinearColor {
  const tint = coverTint(cover);
  return { r: sandMean.r * tint, g: sandMean.g * tint, b: sandMean.b * tint };
}

/** Mean colour of a texture, in the linear space vertex colours are shaded in. */
export function meanTextureColor(texture: THREE.Texture): LinearColor {
  const image: unknown = texture.image;
  if (!(image instanceof HTMLImageElement || image instanceof ImageBitmap || image instanceof HTMLCanvasElement)) {
    throw new Error('meanTextureColor: the texture holds no drawable image');
  }
  // A downscale this large still averages every source pixel into some output pixel.
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('meanTextureColor: 2D canvas context unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const linear = new THREE.Color();
  const sum = { r: 0, g: 0, b: 0 };
  for (let pixel = 0; pixel < size * size; pixel++) {
    linear.setRGB(pixels[pixel * 4] / 255, pixels[pixel * 4 + 1] / 255, pixels[pixel * 4 + 2] / 255, THREE.SRGBColorSpace);
    sum.r += linear.r;
    sum.g += linear.g;
    sum.b += linear.b;
  }
  const count = size * size;
  return { r: sum.r / count, g: sum.g / count, b: sum.b / count };
}

export interface FarColors {
  sandMean: LinearColor;
  /** What the near mesh's rock layer averages to at a distance. */
  rockMean: LinearColor;
}

function addNearMask(material: THREE.MeshStandardMaterial, mask: THREE.DataTexture): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.nearMask = { value: mask };
    shader.vertexShader = 'varying vec2 vFarWorld;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vFarWorld = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader = 'uniform sampler2D nearMask;\nvarying vec2 vFarWorld;\n'
      + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        ivec2 maskCell = ivec2(floor(vFarWorld / ${CHUNK_SIZE.toFixed(1)})) - ivec2(${FAR_MASK_FIRST_CHUNK});
        if (all(greaterThanEqual(maskCell, ivec2(0))) && all(lessThan(maskCell, ivec2(${FAR_MASK_CHUNKS})))
          && texelFetch(nearMask, maskCell, 0).r > 0.5) discard;`);
  };
  material.customProgramCacheKey = () => 'far-terrain-near-mask';
}

export class FarTerrain {
  readonly mesh: THREE.Mesh;
  private readonly maskData = new Uint8Array(FAR_MASK_CHUNKS * FAR_MASK_CHUNKS);
  private readonly mask: THREE.DataTexture;

  constructor(grid: FarGrid, colors: FarColors) {
    this.mask = new THREE.DataTexture(this.maskData, FAR_MASK_CHUNKS, FAR_MASK_CHUNKS, THREE.RedFormat, THREE.UnsignedByteType);
    this.mask.magFilter = THREE.NearestFilter;
    this.mask.minFilter = THREE.NearestFilter;
    this.mask.generateMipmaps = false;
    this.mask.needsUpdate = true;

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    addNearMask(material, this.mask);
    this.mesh = new THREE.Mesh(buildFarGeometry(grid, colors), material);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Drawn before the near chunks; it never covers them, because its fragments under a drawn chunk are discarded.
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** Marks a near chunk as drawn or gone; call in the same frame its mesh is added or removed. */
  setNearChunkDrawn(chunk: ChunkCoord, drawn: boolean): void {
    const column = chunk.cx - FAR_MASK_FIRST_CHUNK;
    const row = chunk.cz - FAR_MASK_FIRST_CHUNK;
    if (column < 0 || row < 0 || column >= FAR_MASK_CHUNKS || row >= FAR_MASK_CHUNKS) return;
    const value = drawn ? 255 : 0;
    if (this.maskData[row * FAR_MASK_CHUNKS + column] === value) return;
    this.maskData[row * FAR_MASK_CHUNKS + column] = value;
    this.mask.needsUpdate = true;
  }
}

function buildFarGeometry(grid: FarGrid, colors: FarColors): THREE.BufferGeometry {
  const side = grid.verticesPerSide;
  const vertexCount = side * side;
  const positions = new Float32Array(vertexCount * 3);
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      const vertex = row * side + column;
      const x = grid.originX + column * grid.step;
      const z = grid.originZ + row * grid.step;
      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = visualTerrainHeight(grid.heights[vertex], x, z);
      positions[vertex * 3 + 2] = z;
    }
  }
  const normals = gridNormals(positions, side);

  const colorValues = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const slope = Math.hypot(normals[vertex * 3], normals[vertex * 3 + 2]) / Math.max(Math.abs(normals[vertex * 3 + 1]), 1e-4);
    const x = positions[vertex * 3];
    const z = positions[vertex * 3 + 2];
    const rockWeight = rockWeightAt(x, z, slope);
    const cover = coverFromIndex(grid.covers[vertex]);
    const ground = farVertexColor(cover, colors.sandMean);
    // The same order as the near shader: the rock mix first, then the surface tint over both.
    const tinted = tintColor({
      r: ground.r + (colors.rockMean.r - ground.r) * rockWeight,
      g: ground.g + (colors.rockMean.g - ground.g) * rockWeight,
      b: ground.b + (colors.rockMean.b - ground.b) * rockWeight,
    }, surfaceTintFor(surfaceTintAt(x, z, cover)));
    colorValues[vertex * 3] = tinted.r;
    colorValues[vertex * 3 + 1] = tinted.g;
    colorValues[vertex * 3 + 2] = tinted.b;
  }

  const cells = side - 1;
  const indices = new Uint32Array(cells * cells * 6);
  let next = 0;
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      const topLeft = row * side + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + side;
      const bottomRight = bottomLeft + 1;
      indices[next++] = topLeft; indices[next++] = bottomLeft; indices[next++] = topRight;
      indices[next++] = topRight; indices[next++] = bottomLeft; indices[next++] = bottomRight;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colorValues, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}
