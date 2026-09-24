// src/render/sky.ts
// The Poly Haven goegap HDRI drives the image-based light, the sun direction and the fog colour.
// The pure helpers work on raw pixel data (no three.js state, no DOM) so they stay unit-testable.
import * as THREE from 'three';

/** Equirectangular float pixels as HDRLoader returns them: row 0 is the top of the image. */
export interface HdrImage {
  data: Float32Array;
  width: number;
  height: number;
  channels: number;
}

export interface Direction {
  x: number;
  y: number;
  z: number;
}

export interface LinearColor {
  r: number;
  g: number;
  b: number;
}

/** Brightest value the lighting copy of the HDR may keep. The sun disc above it would light the
 * scene a second time on top of the DirectionalLight, and without a shadow. */
export const ENVIRONMENT_CLAMP = 6;

function luminanceAt(image: HdrImage, pixelIndex: number): number {
  const offset = pixelIndex * image.channels;
  return image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722;
}

/** Unit direction toward the brightest texel, in three's equirectangular mapping. */
export function brightestTexelDirection(image: HdrImage): Direction {
  let best = -Infinity;
  let bestX = 0;
  let bestY = 0;
  for (let row = 0; row < image.height; row++) {
    for (let column = 0; column < image.width; column++) {
      const luminance = luminanceAt(image, row * image.width + column);
      if (luminance > best) {
        best = luminance;
        bestX = column;
        bestY = row;
      }
    }
  }
  const u = (bestX + 0.5) / image.width;
  const v = 1 - (bestY + 0.5) / image.height;
  const phi = (u - 0.5) * Math.PI * 2;
  const theta = (v - 0.5) * Math.PI;
  return {
    x: Math.cos(theta) * Math.cos(phi),
    y: Math.sin(theta),
    z: Math.cos(theta) * Math.sin(phi),
  };
}

/** A copy of the pixels with every colour value capped at `max`; alpha (4-channel data) is kept. */
export function clampHdrPixels(data: Float32Array, channels: number, max: number): Float32Array {
  const clamped = new Float32Array(data.length);
  for (let index = 0; index < data.length; index++) {
    const isAlpha = channels === 4 && index % 4 === 3;
    clamped[index] = isAlpha ? data[index] : Math.min(data[index], max);
  }
  return clamped;
}

/** Mean linear colour of the image row at the horizon (v = 0.5). */
export function horizonColorOf(image: HdrImage): LinearColor {
  const row = Math.min(image.height - 1, Math.floor(image.height / 2));
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let column = 0; column < image.width; column++) {
    const offset = (row * image.width + column) * image.channels;
    red += image.data[offset];
    green += image.data[offset + 1];
    blue += image.data[offset + 2];
  }
  return { r: red / image.width, g: green / image.width, b: blue / image.width };
}

function isFloatImage(image: unknown): image is { data: Float32Array; width: number; height: number } {
  return (
    typeof image === 'object' &&
    image !== null &&
    'data' in image &&
    image.data instanceof Float32Array &&
    'width' in image &&
    typeof image.width === 'number' &&
    'height' in image &&
    typeof image.height === 'number'
  );
}

/** Reads the float pixels out of a texture HDRLoader built with `FloatType`; throws on anything else. */
export function hdrImageOf(texture: THREE.DataTexture): HdrImage {
  const image: unknown = texture.image;
  if (!isFloatImage(image) || image.width <= 0 || image.height <= 0) {
    throw new Error('hdrImageOf: the sky HDR did not decode into Float32 pixels (expected HDRLoader with FloatType).');
  }
  const channels = image.data.length / (image.width * image.height);
  if (channels !== 3 && channels !== 4) {
    throw new Error(`hdrImageOf: unexpected channel count ${channels} in the sky HDR.`);
  }
  return { data: image.data, width: image.width, height: image.height, channels };
}

export interface SkyEnvironment {
  environment: THREE.Texture;
  sunDirection: THREE.Vector3;
  horizonColor: THREE.Color;
}

/** Prefilters the clamped HDR into the scene's environment map and reads the sun and horizon from it. */
export function buildSkyEnvironment(renderer: THREE.WebGLRenderer, hdr: THREE.DataTexture): SkyEnvironment {
  const image = hdrImageOf(hdr);
  const sun = brightestTexelDirection(image);
  const horizon = horizonColorOf(image);

  const clamped = new THREE.DataTexture(
    clampHdrPixels(image.data, image.channels, ENVIRONMENT_CLAMP),
    image.width,
    image.height,
    image.channels === 4 ? THREE.RGBAFormat : THREE.RGBFormat,
    THREE.FloatType,
  );
  clamped.flipY = hdr.flipY;
  clamped.colorSpace = THREE.LinearSRGBColorSpace;
  clamped.mapping = THREE.EquirectangularReflectionMapping;
  clamped.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const environment = pmrem.fromEquirectangular(clamped).texture;
  pmrem.dispose();
  clamped.dispose();

  return {
    environment,
    sunDirection: new THREE.Vector3(sun.x, sun.y, sun.z).normalize(),
    horizonColor: new THREE.Color().setRGB(horizon.r, horizon.g, horizon.b, THREE.LinearSRGBColorSpace),
  };
}
