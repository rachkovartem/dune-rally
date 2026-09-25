// src/render/carMaterials.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CAR_MATERIAL_RECIPES,
  TREAD_GROOVES,
  createCarMaterials,
  flakeNormalPixels,
  setBrakeLights,
  treadNormalMapPixels,
  type CarMaterialSet,
} from './carMaterials';

const NO_EMBEDDED = { tyre: null, brake: null };

/** Decodes the RGB bytes of a normal-map texel back into a vector. */
function normalAt(pixels: Uint8Array, texel: number): { x: number; y: number; z: number } {
  const decode = (byte: number): number => (byte / 255) * 2 - 1;
  return { x: decode(pixels[texel * 4]), y: decode(pixels[texel * 4 + 1]), z: decode(pixels[texel * 4 + 2]) };
}

/** Byte rounding moves a decoded unit normal by up to about 0.007 in length. */
const BYTE_TOLERANCE = 0.02;

describe('treadNormalMapPixels — the generated tyre tread (R43, R44)', () => {
  const size = 256;
  const pixels = treadNormalMapPixels(size);
  const column = (index: number, row: number): number[] => Array.from(pixels.slice((row * size + index) * 4, (row * size + index) * 4 + 4));

  it('tiles round the tyre: the first column continues the last one with no seam', () => {
    // u wraps once per revolution, so a jump between the last and first column is a visible line.
    for (const row of [0, 64, 200]) {
      const first = column(0, row);
      const beforeLast = column(size - 2, row);
      const last = column(size - 1, row);
      const stepAcrossSeam = Math.abs(first[1] - last[1]);
      const stepInside = Math.abs(last[1] - beforeLast[1]);
      expect(stepAcrossSeam).toBeLessThanOrEqual(stepInside + 1);
    }
  });

  it('has exactly TREAD_GROOVES ribs per revolution', () => {
    let peaks = 0;
    for (let index = 0; index < size; index++) {
      const previous = normalAt(pixels, (index - 1 + size) % size).y;
      const current = normalAt(pixels, index).y;
      const next = normalAt(pixels, (index + 1) % size).y;
      if (current > previous && current >= next) peaks++;
    }
    expect(peaks).toBe(TREAD_GROOVES);
  });

  it('decodes every texel to a unit normal facing out of the tyre', () => {
    for (let texel = 0; texel < size * size; texel += 97) {
      const normal = normalAt(pixels, texel);
      expect(normal.z).toBeGreaterThan(0);
      expect(Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1)).toBeLessThan(BYTE_TOLERANCE);
    }
  });
});

describe('flakeNormalPixels — metallic flake for car paint (R105–R108)', () => {
  it('returns one RGBA texel per pixel of a size × size map', () => {
    expect(flakeNormalPixels(256, 0.4, 1)).toHaveLength(256 * 256 * 4);
  });

  it('decodes every texel to a unit normal facing out of the paint, even at full strength', () => {
    const pixels = flakeNormalPixels(64, 1, 7);
    for (let texel = 0; texel < 64 * 64; texel++) {
      const normal = normalAt(pixels, texel);
      expect(normal.z).toBeGreaterThan(0);
      expect(Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1)).toBeLessThan(BYTE_TOLERANCE);
    }
  });

  it('is perfectly flat at strength 0: no fake sparkle', () => {
    const pixels = flakeNormalPixels(16, 0, 7);
    const flat = Array.from(flakeNormalPixels(1, 0, 1));
    for (let texel = 0; texel < 16 * 16; texel++) {
      expect(Array.from(pixels.slice(texel * 4, texel * 4 + 4))).toEqual(flat);
    }
    const decoded = normalAt(pixels, 0);
    expect(decoded.x).toBeCloseTo(0, 2);
    expect(decoded.y).toBeCloseTo(0, 2);
    expect(decoded.z).toBeCloseTo(1, 2);
  });

  it('gives the same bytes for the same seed and different bytes for another seed', () => {
    expect(flakeNormalPixels(32, 0.5, 3)).toEqual(flakeNormalPixels(32, 0.5, 3));
    expect(flakeNormalPixels(32, 0.5, 3)).not.toEqual(flakeNormalPixels(32, 0.5, 4));
  });

  it.each([-0.1, 1.01, Number.NaN])('throws for a strength of %s, which could tip a normal below the surface', (strength) => {
    expect(() => flakeNormalPixels(8, strength, 1)).toThrow('strength must be in [0, 1]');
  });
});

describe('createCarMaterials — one full material set per car (R109, R110)', () => {
  it('draws the tyres with the car\'s own embedded tread textures when the model ships them', () => {
    const tyre = { map: new THREE.Texture(), normalMap: new THREE.Texture() };
    const materials = createCarMaterials(CAR_MATERIAL_RECIPES.forester, { tyre, brake: null });
    expect(materials.rubber.map).toBe(tyre.map);
    expect(materials.rubber.normalMap).toBe(tyre.normalMap);
  });

  it('draws the tyres with the generated tread when the model ships no tyre textures', () => {
    const materials = createCarMaterials(CAR_MATERIAL_RECIPES.pajero, NO_EMBEDDED);
    const tread = materials.rubber.normalMap;
    expect(tread).toBeInstanceOf(THREE.DataTexture);
    expect(materials.rubber.map).toBeNull();
    if (!(tread instanceof THREE.DataTexture)) return;
    expect(tread.image.data).toEqual(treadNormalMapPixels(tread.image.width));
    expect(tread.wrapS).toBe(THREE.RepeatWrapping);
  });

  it('puts the embedded brake-disc textures on the brake material only', () => {
    const brake = { map: new THREE.Texture(), normalMap: new THREE.Texture() };
    const materials = createCarMaterials(CAR_MATERIAL_RECIPES.forester, { tyre: null, brake });
    expect(materials.brake.map).toBe(brake.map);
    expect(materials.rubber.map).toBeNull();
  });

  it('builds a new material for every slot on every call: no two cars share one', () => {
    const first = createCarMaterials(CAR_MATERIAL_RECIPES.forester, NO_EMBEDDED);
    const second = createCarMaterials(CAR_MATERIAL_RECIPES.forester, NO_EMBEDDED);
    const slots = Object.keys(first).filter((slot): slot is keyof CarMaterialSet => slot in first);
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(first[slot]).not.toBe(second[slot]);
  });
});

describe('setBrakeLights — each car lights only its own tail lights (R56, R57)', () => {
  it('brightens the tail lights while braking and returns them to their idle glow after', () => {
    const materials = createCarMaterials(CAR_MATERIAL_RECIPES.pajero, NO_EMBEDDED);
    const idle = materials.taillight.emissiveIntensity;
    setBrakeLights(materials, true);
    expect(materials.taillight.emissiveIntensity).toBeGreaterThan(idle);
    setBrakeLights(materials, false);
    expect(materials.taillight.emissiveIntensity).toBe(idle);
  });

  it('keeps each car\'s own idle glow: the Forester and the Pajero return to their own levels', () => {
    const forester = createCarMaterials(CAR_MATERIAL_RECIPES.forester, NO_EMBEDDED);
    const pajero = createCarMaterials(CAR_MATERIAL_RECIPES.pajero, NO_EMBEDDED);
    const foresterIdle = forester.taillight.emissiveIntensity;
    const pajeroIdle = pajero.taillight.emissiveIntensity;
    setBrakeLights(forester, true);
    setBrakeLights(pajero, true);
    setBrakeLights(forester, false);
    setBrakeLights(pajero, false);
    expect(forester.taillight.emissiveIntensity).toBe(foresterIdle);
    expect(pajero.taillight.emissiveIntensity).toBe(pajeroIdle);
  });

  it('leaves the other car\'s tail lights at their idle glow', () => {
    const forester = createCarMaterials(CAR_MATERIAL_RECIPES.forester, NO_EMBEDDED);
    const pajero = createCarMaterials(CAR_MATERIAL_RECIPES.pajero, NO_EMBEDDED);
    const pajeroIdle = pajero.taillight.emissiveIntensity;
    setBrakeLights(forester, true);
    expect(pajero.taillight.emissiveIntensity).toBe(pajeroIdle);
  });

  it('throws for a material set it did not build, instead of guessing an idle level', () => {
    const materials = createCarMaterials(CAR_MATERIAL_RECIPES.pajero, NO_EMBEDDED);
    const foreign: CarMaterialSet = { ...materials, taillight: new THREE.MeshStandardMaterial() };
    expect(() => setBrakeLights(foreign, true)).toThrow('was not built by createCarMaterials()');
  });
});
