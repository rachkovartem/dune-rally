// src/render/waterMaterial.ts
// The lake's water: an IBL reflection of the sky (already baked for lighting — no extra scene
// render), a scrolling generated ripple normal, and a Fresnel-driven opacity. No `WaterMesh`
// planar mirror — the spec explicitly rules that cost out for "reflections of the sky".
import * as THREE from 'three/webgpu';
import {
  texture, vec2, vec3, positionWorld, time, mix, dot, normalize, cameraPosition, pow, saturate,
  float, reflect,
} from 'three/tsl';
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

/** Shared single-instance lake water material: IBL sky reflection, scrolling ripple normal,
 * Fresnel opacity, and a subtle sun glint toward the reflection direction. */
export function createWaterMaterial(environment: THREE.Texture, sunDirection: THREE.Vector3): THREE.MeshPhysicalNodeMaterial {
  const material = new THREE.MeshPhysicalNodeMaterial({
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
  material.envMap = environment;

  const ripple = rippleNormalTexture(256, 7);
  const baseUv = positionWorld.xz.mul(0.12);
  const scrollA = baseUv.add(vec2(time.mul(0.012), time.mul(0.007)));
  const scrollB = baseUv.mul(1.7).add(vec2(time.mul(-0.009), time.mul(0.014)));
  const sampleA = texture(ripple, scrollA).rgb.mul(2).sub(1);
  const sampleB = texture(ripple, scrollB).rgb.mul(2).sub(1);
  const rippleNormal = sampleA.add(sampleB).normalize();

  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(saturate(float(1).sub(dot(viewDirection, rippleNormal))), 3);

  material.normalNode = rippleNormal;
  material.colorNode = vec3(0.03, 0.15, 0.17);
  material.opacityNode = mix(0.55, 0.96, fresnel);

  const sunDirectionNode = vec3(sunDirection.x, sunDirection.y, sunDirection.z);
  const sunGlint = pow(saturate(dot(reflect(viewDirection.negate(), rippleNormal), sunDirectionNode)), 120);
  material.emissiveNode = vec3(1, 0.95, 0.85).mul(sunGlint).mul(0.5);

  return material;
}
