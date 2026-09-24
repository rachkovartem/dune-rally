// src/render/carMaterials.ts
// One material per car-part slot, built fresh for every car (see buggyMesh.ts) so a taillight's
// brake state never leaks to another car sharing the same scene. The pixel generators stay free
// of three.js state so they are unit-testable without a DOM/WebGL context.
import * as THREE from 'three';
import type { CarMaterialSlot } from '../assets/carPartRules';
import type { CarId } from '../vehicle/cars';

export type CarMaterialSet = Record<CarMaterialSlot, THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial>;

export interface CarPaintRecipe {
  color: number;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** 0 = no flake normal map. The paint mesh must then carry a UV set (checked in buggyMesh.ts). */
  flakeStrength: number;
}

export interface CarSurfaceRecipe {
  color: number;
  metalness: number;
  roughness: number;
  emissive: { color: number; intensity: number } | null;
}

export interface CarGlassRecipe {
  color: number;
  roughness: number;
  opacity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  doubleSided: boolean;
}

/** Every slot the two cars style differently. The Pajero keeps its accepted values (spec), and
 * the Forester takes the drive prototype's values the user approved. */
export interface CarMaterialRecipe {
  paint: CarPaintRecipe;
  glass: CarGlassRecipe;
  chrome: CarSurfaceRecipe;
  rubber: CarSurfaceRecipe;
  rim: CarSurfaceRecipe;
  headlight: CarSurfaceRecipe;
  taillight: CarSurfaceRecipe;
  interior: CarSurfaceRecipe;
  blackTrim: CarSurfaceRecipe;
}

export interface CarTextureMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
}

/** Textures shipped inside a car GLB; null when that car has no such textured part. */
export interface EmbeddedCarMaps {
  tyre: CarTextureMaps | null;
  brake: CarTextureMaps | null;
}

const TAILLIGHT_BRAKE_EMISSIVE_INTENSITY = 3.0;
const TAILLIGHT_IDLE_INTENSITY_KEY = 'idleEmissiveIntensity';

export const CAR_MATERIAL_RECIPES: Record<CarId, CarMaterialRecipe> = {
  pajero: {
    paint: { color: 0x3a3d43, metalness: 0.55, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08, flakeStrength: 0 },
    glass: { color: 0x0b1218, roughness: 0.02, opacity: 0.75, clearcoat: 0, clearcoatRoughness: 0, doubleSided: true },
    chrome: { color: 0xc9cbd1, metalness: 1, roughness: 0.12, emissive: null },
    rubber: { color: 0x0f1012, metalness: 0, roughness: 0.9, emissive: null },
    rim: { color: 0xc7cacf, metalness: 0.9, roughness: 0.25, emissive: null },
    headlight: { color: 0xfff2cf, metalness: 0, roughness: 0.3, emissive: { color: 0xfff2cf, intensity: 1.8 } },
    taillight: { color: 0x7a1410, metalness: 0, roughness: 0.3, emissive: { color: 0xff2a1a, intensity: 0.8 } },
    interior: { color: 0x15171a, metalness: 0, roughness: 0.95, emissive: null },
    blackTrim: { color: 0x1a1b1d, metalness: 0, roughness: 0.7, emissive: null },
  },
  forester: {
    // No flake: the converted paint mesh has no UV set, and the approved prototype has none.
    paint: { color: 0x0b0c0e, metalness: 0.6, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03, flakeStrength: 0 },
    glass: { color: 0x0a0f14, roughness: 0.03, opacity: 0.85, clearcoat: 1, clearcoatRoughness: 0.02, doubleSided: false },
    chrome: { color: 0xdadde0, metalness: 1, roughness: 0.15, emissive: null },
    rubber: { color: 0x141517, metalness: 0, roughness: 0.9, emissive: null },
    rim: { color: 0xb9bcc0, metalness: 0.95, roughness: 0.28, emissive: null },
    headlight: { color: 0xe8ecef, metalness: 0.8, roughness: 0.2, emissive: { color: 0xfff2cf, intensity: 0.3 } },
    taillight: { color: 0x6a0a0a, metalness: 0.2, roughness: 0.3, emissive: { color: 0xff2a1a, intensity: 0.6 } },
    interior: { color: 0x15171a, metalness: 0, roughness: 0.95, emissive: null },
    blackTrim: { color: 0x1a1b1d, metalness: 0.1, roughness: 0.7, emissive: null },
  },
};

/** Ribs per tyre revolution in the generated tread normal map. */
export const TREAD_GROOVES = 40;
const TREAD_TEXTURE_SIZE = 256;
const TREAD_GROOVE_DEPTH = 0.6;
const FLAKE_TEXTURE_SIZE = 256;
const FLAKE_NORMAL_SCALE = 0.3;

function encodeNormalByte(component: number): number {
  return Math.round((component * 0.5 + 0.5) * 255);
}

/**
 * A tileable tread normal map for the tyre's cylindrical UV (carModel.ts's cylindricalUv): u
 * wraps once around the tyre with TREAD_GROOVES raised ribs, v runs across the tread width. The
 * source tyre mesh is smooth (no tread geometry), so this is generated rather than downloaded.
 */
export function treadNormalMapPixels(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    const v = row / size;
    for (let col = 0; col < size; col++) {
      const u = col / size;
      const grooveAngle = u * TREAD_GROOVES * 2 * Math.PI;
      const tangentTilt = Math.cos(grooveAngle) * TREAD_GROOVE_DEPTH;
      const lateralTilt = Math.sin(v * Math.PI * 4) * TREAD_GROOVE_DEPTH * 0.25;
      const length = Math.hypot(lateralTilt, tangentTilt, 1) || 1;
      const index = (row * size + col) * 4;
      pixels[index] = encodeNormalByte(lateralTilt / length);
      pixels[index + 1] = encodeNormalByte(tangentTilt / length);
      pixels[index + 2] = encodeNormalByte(1 / length);
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Random per-texel tilts for a metallic-flake normal map (the probe's flakeNormal). Each tilt
 * component lies in [-strength/2, strength/2], so strength must stay in [0, 1] for every texel
 * to decode to a unit normal facing out of the surface.
 */
export function flakeNormalPixels(size: number, strength: number, seed: number): Uint8Array {
  if (!(strength >= 0 && strength <= 1)) {
    throw new Error(`flakeNormalPixels: strength must be in [0, 1], got ${strength}`);
  }
  let state = seed >>> 0;
  const nextRandom = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const pixels = new Uint8Array(size * size * 4);
  for (let texel = 0; texel < size * size; texel++) {
    const tiltX = (nextRandom() - 0.5) * strength;
    const tiltY = (nextRandom() - 0.5) * strength;
    const normalZ = Math.sqrt(1 - tiltX * tiltX - tiltY * tiltY);
    pixels[texel * 4] = encodeNormalByte(tiltX);
    pixels[texel * 4 + 1] = encodeNormalByte(tiltY);
    pixels[texel * 4 + 2] = encodeNormalByte(normalZ);
    pixels[texel * 4 + 3] = 255;
  }
  return pixels;
}

function repeatingDataTexture(pixels: Uint8Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

let sharedTreadNormalTexture: THREE.DataTexture | null = null;

/** Built once and shared: the tread pattern is the same for every tyre, only the material
 * instance (and its taillight) is per car. */
function treadNormalTexture(): THREE.DataTexture {
  if (!sharedTreadNormalTexture) {
    sharedTreadNormalTexture = repeatingDataTexture(treadNormalMapPixels(TREAD_TEXTURE_SIZE), TREAD_TEXTURE_SIZE);
  }
  return sharedTreadNormalTexture;
}

const flakeTexturesByStrength = new Map<number, THREE.DataTexture>();

function flakeNormalTexture(strength: number): THREE.DataTexture {
  const cached = flakeTexturesByStrength.get(strength);
  if (cached) return cached;
  const texture = repeatingDataTexture(flakeNormalPixels(FLAKE_TEXTURE_SIZE, strength, 3), FLAKE_TEXTURE_SIZE);
  texture.magFilter = THREE.NearestFilter;
  flakeTexturesByStrength.set(strength, texture);
  return texture;
}

function surfaceMaterial(recipe: CarSurfaceRecipe, maps: CarTextureMaps | null = null): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: recipe.color,
    metalness: recipe.metalness,
    roughness: recipe.roughness,
  });
  if (recipe.emissive) {
    material.emissive.setHex(recipe.emissive.color);
    material.emissiveIntensity = recipe.emissive.intensity;
  }
  if (maps) {
    material.map = maps.map;
    material.normalMap = maps.normalMap;
  }
  return material;
}

function glassMaterial(recipe: CarGlassRecipe): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: recipe.color,
    metalness: 0,
    roughness: recipe.roughness,
    transparent: true,
    opacity: recipe.opacity,
    depthWrite: false,
    clearcoat: recipe.clearcoat,
    clearcoatRoughness: recipe.clearcoatRoughness,
    side: recipe.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
}

function paintMaterial(recipe: CarPaintRecipe): THREE.MeshPhysicalMaterial {
  const paint = new THREE.MeshPhysicalMaterial({
    color: recipe.color,
    metalness: recipe.metalness,
    roughness: recipe.roughness,
    clearcoat: recipe.clearcoat,
    clearcoatRoughness: recipe.clearcoatRoughness,
  });
  if (recipe.flakeStrength > 0) {
    paint.normalMap = flakeNormalTexture(recipe.flakeStrength);
    paint.normalScale.set(FLAKE_NORMAL_SCALE, FLAKE_NORMAL_SCALE);
  }
  return paint;
}

/**
 * Builds one full set of car materials from a car's recipe. Called once per car (buggyMesh.ts),
 * never module-shared: the taillight must be independent per car so one player's braking never
 * lights another player's tail lights.
 */
export function createCarMaterials(recipe: CarMaterialRecipe, embedded: EmbeddedCarMaps): CarMaterialSet {
  const rubber = surfaceMaterial(recipe.rubber, embedded.tyre);
  if (!embedded.tyre) rubber.normalMap = treadNormalTexture();

  const taillight = surfaceMaterial(recipe.taillight);
  taillight.userData[TAILLIGHT_IDLE_INTENSITY_KEY] = taillight.emissiveIntensity;

  return {
    paint: paintMaterial(recipe.paint),
    glass: glassMaterial(recipe.glass),
    clearGlass: glassMaterial({
      color: 0xdfe8ee, roughness: 0.02, opacity: 0.35, clearcoat: 1, clearcoatRoughness: 0.02, doubleSided: true,
    }),
    chrome: surfaceMaterial(recipe.chrome),
    rubber,
    rim: surfaceMaterial(recipe.rim),
    headlight: surfaceMaterial(recipe.headlight),
    taillight,
    interior: surfaceMaterial(recipe.interior),
    blackTrim: surfaceMaterial(recipe.blackTrim),
    indicator: surfaceMaterial({
      color: 0xd07a10, metalness: 0.2, roughness: 0.3, emissive: { color: 0xff8a10, intensity: 0.2 },
    }),
    silver: surfaceMaterial({ color: 0x8e9196, metalness: 0.9, roughness: 0.45, emissive: null }),
    rimDark: surfaceMaterial({ color: 0x2a2c2f, metalness: 0.8, roughness: 0.4, emissive: null }),
    brake: surfaceMaterial({ color: 0x9a9a9a, metalness: 0.9, roughness: 0.45, emissive: null }, embedded.brake),
    plate: surfaceMaterial({ color: 0xe6e6e0, metalness: 0, roughness: 0.6, emissive: null }),
  };
}

/**
 * Brightens or dims one car's own tail lights. Acts only on the material set passed in, so
 * braking never lights another car's tail lights sharing the same scene (user decision).
 */
export function setBrakeLights(materials: CarMaterialSet, braking: boolean): void {
  const idleIntensity: unknown = materials.taillight.userData[TAILLIGHT_IDLE_INTENSITY_KEY];
  if (typeof idleIntensity !== 'number') {
    throw new Error('setBrakeLights: this material set was not built by createCarMaterials()');
  }
  materials.taillight.emissiveIntensity = braking ? TAILLIGHT_BRAKE_EMISSIVE_INTENSITY : idleIntensity;
}
