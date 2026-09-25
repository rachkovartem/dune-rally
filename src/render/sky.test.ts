// src/render/sky.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { brightestTexelDirection, clampHdrPixels, hdrImageOf, horizonColorOf, type HdrImage } from './sky';

const WIDTH = 64;
const HEIGHT = 32;

/** An equirectangular image of one flat colour, row 0 at the top. */
function flatImage(channels: 3 | 4, colour: [number, number, number] = [0.2, 0.2, 0.2]): HdrImage {
  const data = new Float32Array(WIDTH * HEIGHT * channels);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
    data.set(colour, pixel * channels);
    if (channels === 4) data[pixel * channels + 3] = 1;
  }
  return { data, width: WIDTH, height: HEIGHT, channels };
}

function paint(image: HdrImage, row: number, column: number, value: number): void {
  image.data.fill(value, (row * image.width + column) * image.channels, (row * image.width + column) * image.channels + 3);
}

const length = (direction: { x: number; y: number; z: number }): number => Math.hypot(direction.x, direction.y, direction.z);

describe('brightestTexelDirection — the sun direction read from the HDRI (R77–R80)', () => {
  it('points almost straight up for a bright texel in the top row', () => {
    const image = flatImage(3);
    paint(image, 0, WIDTH / 2, 500);
    const sun = brightestTexelDirection(image);
    expect(sun.y).toBeGreaterThan(0.9);
    expect(length(sun)).toBeCloseTo(1, 9);
  });

  it('points almost straight down for a bright texel in the bottom row', () => {
    const image = flatImage(3);
    paint(image, HEIGHT - 1, 3, 500);
    expect(brightestTexelDirection(image).y).toBeLessThan(-0.9);
  });

  it('points along the horizon for a bright texel on the middle row', () => {
    const image = flatImage(3);
    paint(image, HEIGHT / 2, WIDTH / 2, 500);
    expect(Math.abs(brightestTexelDirection(image).y)).toBeLessThan(0.3);
  });

  it('agrees with three.js on where a texel of an equirectangular map lies', () => {
    // The sun light must come from the spot where the scene background draws the sun disc.
    const image = flatImage(3);
    const row = 9;
    const column = 45;
    paint(image, row, column, 500);
    const sun = brightestTexelDirection(image);
    // three's equirectUv: u = atan(dir.z, dir.x) / (2π) + 0.5, v = asin(dir.y) / π + 0.5 (v up).
    const u = Math.atan2(sun.z, sun.x) / (2 * Math.PI) + 0.5;
    const v = Math.asin(THREE.MathUtils.clamp(sun.y, -1, 1)) / Math.PI + 0.5;
    expect(u).toBeCloseTo((column + 0.5) / WIDTH, 6);
    expect(1 - v).toBeCloseTo((row + 0.5) / HEIGHT, 6);
  });

  it('picks the brighter of two bright texels', () => {
    const image = flatImage(3);
    paint(image, 2, 10, 200);
    paint(image, 20, 50, 900);
    const sun = brightestTexelDirection(image);
    expect(sun.y).toBeLessThan(0);
  });

  it('weighs green over blue as the eye does (luminance, not the sum of channels)', () => {
    const image = flatImage(3, [0, 0, 0]);
    image.data.set([0, 10, 0], (4 * WIDTH + 7) * 3);
    image.data.set([0, 0, 20], ((HEIGHT - 5) * WIDTH + 7) * 3);
    expect(brightestTexelDirection(image).y).toBeGreaterThan(0);
  });

  it('gives the same direction for the same pixels stored with 3 and with 4 channels', () => {
    const rgb = flatImage(3);
    const rgba = flatImage(4);
    paint(rgb, 7, 21, 300);
    paint(rgba, 7, 21, 300);
    expect(brightestTexelDirection(rgba)).toEqual(brightestTexelDirection(rgb));
  });
});

describe('clampHdrPixels (R81, R82)', () => {
  it('caps colour values above the limit at the limit', () => {
    expect(Array.from(clampHdrPixels(Float32Array.from([50, 7, 6.5]), 3, 6))).toEqual([6, 6, 6]);
  });

  it('keeps values at or below the limit as they are', () => {
    expect(Array.from(clampHdrPixels(Float32Array.from([6, 0.25, 0]), 3, 6))).toEqual([6, 0.25, 0]);
  });

  it('never clamps the alpha of 4-channel data, only its colour', () => {
    expect(Array.from(clampHdrPixels(Float32Array.from([9, 9, 9, 9, 1, 2, 3, 40]), 4, 6))).toEqual([6, 6, 6, 9, 1, 2, 3, 40]);
  });

  it('clamps every value of 3-channel data (there is no alpha)', () => {
    expect(Array.from(clampHdrPixels(Float32Array.from([1, 2, 3, 40]), 3, 6))).toEqual([1, 2, 3, 6]);
  });

  it('returns a copy and leaves the source pixels untouched', () => {
    const source = Float32Array.from([50, 1, 1]);
    const clamped = clampHdrPixels(source, 3, 6);
    expect(clamped).not.toBe(source);
    expect(Array.from(source)).toEqual([50, 1, 1]);
  });
});

describe('horizonColorOf — the fog colour (R83)', () => {
  it('is the mean colour of the middle row, not of the sky above or the ground below', () => {
    const image = flatImage(3, [0.1, 0.3, 0.9]);
    for (let row = HEIGHT / 2; row < HEIGHT; row++) {
      for (let column = 0; column < WIDTH; column++) image.data.set([0.8, 0.6, 0.4], (row * WIDTH + column) * 3);
    }
    for (let column = 0; column < WIDTH; column++) {
      image.data.set(column < WIDTH / 2 ? [1, 0, 0] : [0, 0, 1], ((HEIGHT / 2) * WIDTH + column) * 3);
    }
    const horizon = horizonColorOf(image);
    expect(horizon.r).toBeCloseTo(0.5, 6);
    expect(horizon.g).toBeCloseTo(0, 6);
    expect(horizon.b).toBeCloseTo(0.5, 6);
  });

  it('reads 4-channel data by its own stride', () => {
    const horizon = horizonColorOf(flatImage(4, [0.25, 0.5, 0.75]));
    expect(horizon).toEqual({ r: 0.25, g: 0.5, b: 0.75 });
  });
});

describe('hdrImageOf', () => {
  const texture = (data: Float32Array | Uint8Array, width: number, height: number): THREE.DataTexture =>
    new THREE.DataTexture(data, width, height);

  it.each([3, 4])('reads a %s-channel float texture', (channels) => {
    const image = hdrImageOf(texture(new Float32Array(8 * 4 * channels), 8, 4));
    expect(image.channels).toBe(channels);
    expect(image.width).toBe(8);
    expect(image.height).toBe(4);
  });

  it('refuses 8-bit pixels: the HDR was not decoded as floats', () => {
    expect(() => hdrImageOf(texture(new Uint8Array(8 * 4 * 4), 8, 4))).toThrow('did not decode into Float32 pixels');
  });

  it('refuses an empty image', () => {
    expect(() => hdrImageOf(texture(new Float32Array(0), 0, 0))).toThrow('hdrImageOf');
  });

  it('refuses a channel count that is neither 3 nor 4', () => {
    expect(() => hdrImageOf(texture(new Float32Array(8 * 4 * 2), 8, 4))).toThrow('unexpected channel count 2');
  });
});
