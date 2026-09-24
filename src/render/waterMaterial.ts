// src/render/waterMaterial.ts
// The lake's water: the sky reflection comes from `scene.environment` (no extra scene render, no
// planar mirror) and a generated, scrolling ripple normal breaks it up.
import * as THREE from 'three';
import { mulberry32 } from '../world/rng';

interface RippleWave {
  freqU: number; // integer wave count across the tile — guarantees exact periodicity
  freqV: number;
  phase: number;
  amplitude: number;
}

function rippleWaves(seed: number): RippleWave[] {
  const rng = mulberry32(seed >>> 0);
  return Array.from({ length: 5 }, () => ({
    freqU: 1 + Math.floor(rng() * 4),
    freqV: 1 + Math.floor(rng() * 4),
    phase: rng() * Math.PI * 2,
    amplitude: 0.15 + rng() * 0.15,
  }));
}

function rippleHeightAt(waves: readonly RippleWave[], u: number, v: number): number {
  let height = 0;
  for (const wave of waves) {
    height += wave.amplitude * Math.sin(2 * Math.PI * (wave.freqU * u + wave.freqV * v) + wave.phase);
  }
  return height;
}

/**
 * Generates a tileable ripple normal map as raw RGBA bytes (deterministic per seed): a handful of
 * integer-frequency sine waves give an exactly periodic height field, finite-differenced into a
 * normal. Row/column `size - 1` are copied from row/column `0` so the tile edge matches exactly,
 * not just "close enough" after floating-point rounding.
 */
export function rippleNormalPixels(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const waves = rippleWaves(seed);
  const step = 1 / size;

  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const u = col / size;
      const v = row / size;
      const dHdu = rippleHeightAt(waves, u + step, v) - rippleHeightAt(waves, u - step, v);
      const dHdv = rippleHeightAt(waves, u, v + step) - rippleHeightAt(waves, u, v - step);
      const nx = -dHdu * 0.5;
      const ny = -dHdv * 0.5;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const index = (row * size + col) * 4;
      data[index] = Math.round((nx / length * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round((nz / length * 0.5 + 0.5) * 255);
      data[index + 3] = 255;
    }
  }

  for (let col = 0; col < size; col++) {
    const source = col * 4;
    const target = ((size - 1) * size + col) * 4;
    data.copyWithin(target, source, source + 4);
  }
  for (let row = 0; row < size; row++) {
    const rowStart = row * size * 4;
    data.copyWithin(rowStart + (size - 1) * 4, rowStart, rowStart + 4);
  }

  return data;
}

export function rippleNormalTexture(size: number, seed: number): THREE.DataTexture {
  const texture2d = new THREE.DataTexture(rippleNormalPixels(size, seed), size, size, THREE.RGBAFormat);
  texture2d.wrapS = THREE.RepeatWrapping;
  texture2d.wrapT = THREE.RepeatWrapping;
  texture2d.needsUpdate = true;
  return texture2d;
}

/** Ripple tiles per metre of water surface. */
export const WATER_RIPPLE_REPEATS_PER_METRE = 0.12;

/** Shared single-instance lake water material; the caller scrolls `normalMap.offset`. */
export function createWaterMaterial(ripple: THREE.Texture): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1d4a55,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    roughness: 0.06,
    metalness: 0,
    normalMap: ripple,
  });
}
