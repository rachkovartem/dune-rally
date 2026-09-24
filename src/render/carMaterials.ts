// src/render/carMaterials.ts
// One material per car-part slot, built fresh for every car (see buggyMesh.ts) so a taillight's
// brake state never leaks to another car sharing the same scene. treadNormalMapPixels stays free
// of three.js imports so it is unit-testable without a DOM/WebGPU context.
import * as THREE from 'three/webgpu';

export interface CarMaterialSet {
  paint: THREE.MeshPhysicalNodeMaterial;
  glass: THREE.MeshPhysicalNodeMaterial;
  chrome: THREE.MeshStandardNodeMaterial;
  rubber: THREE.MeshStandardNodeMaterial;
  rim: THREE.MeshStandardNodeMaterial;
  headlight: THREE.MeshStandardNodeMaterial;
  taillight: THREE.MeshStandardNodeMaterial;
  interior: THREE.MeshStandardNodeMaterial;
  blackTrim: THREE.MeshStandardNodeMaterial;
}

const HEADLIGHT_EMISSIVE_INTENSITY = 1.8;
const TAILLIGHT_IDLE_EMISSIVE_INTENSITY = 0.8;
const TAILLIGHT_BRAKE_EMISSIVE_INTENSITY = 3.0;

/** Ribs per tyre revolution in the generated tread normal map. */
export const TREAD_GROOVES = 40;
const TREAD_TEXTURE_SIZE = 256;
const TREAD_GROOVE_DEPTH = 0.6;

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

let sharedTreadNormalTexture: THREE.DataTexture | null = null;

/** Lazily built once and shared by every car's rubber material — the tread pattern is identical
 * for every tyre; only the material instance (and its taillight) is per car. */
function treadNormalTexture(): THREE.DataTexture {
  if (!sharedTreadNormalTexture) {
    const pixels = treadNormalMapPixels(TREAD_TEXTURE_SIZE);
    const texture = new THREE.DataTexture(
      pixels,
      TREAD_TEXTURE_SIZE,
      TREAD_TEXTURE_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    sharedTreadNormalTexture = texture;
  }
  return sharedTreadNormalTexture;
}

/**
 * Builds one full set of car materials — paint, glass, chrome, rubber, rim, head/tail lights,
 * interior, black trim. Called once per car (buggyMesh.ts), not module-shared: the taillight
 * must be independent per car so one player's braking never lights another player's tail lights.
 */
export function createCarMaterials(environment: THREE.Texture): CarMaterialSet {
  const paint = new THREE.MeshPhysicalNodeMaterial({
    color: 0x3a3d43,
    metalness: 0.55,
    roughness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMap: environment,
  });

  const glass = new THREE.MeshPhysicalNodeMaterial({
    color: 0x0b1218,
    roughness: 0.02,
    metalness: 0,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMap: environment,
  });

  const chrome = new THREE.MeshStandardNodeMaterial({
    color: 0xc9cbd1,
    metalness: 1,
    roughness: 0.12,
    envMap: environment,
  });

  const rubber = new THREE.MeshStandardNodeMaterial({
    color: 0x0f1012,
    roughness: 0.9,
    metalness: 0,
    normalMap: treadNormalTexture(),
  });

  const rim = new THREE.MeshStandardNodeMaterial({
    color: 0xc7cacf,
    metalness: 0.9,
    roughness: 0.25,
    envMap: environment,
  });

  const headlight = new THREE.MeshStandardNodeMaterial({
    color: 0xfff2cf,
    roughness: 0.3,
    metalness: 0,
    emissive: 0xfff2cf,
    emissiveIntensity: HEADLIGHT_EMISSIVE_INTENSITY,
  });

  const taillight = new THREE.MeshStandardNodeMaterial({
    color: 0x7a1410,
    roughness: 0.3,
    metalness: 0,
    emissive: 0xff2a1a,
    emissiveIntensity: TAILLIGHT_IDLE_EMISSIVE_INTENSITY,
  });

  const interior = new THREE.MeshStandardNodeMaterial({
    color: 0x15171a,
    roughness: 0.95,
    metalness: 0,
  });

  const blackTrim = new THREE.MeshStandardNodeMaterial({
    color: 0x1a1b1d,
    roughness: 0.7,
    metalness: 0,
  });

  return { paint, glass, chrome, rubber, rim, headlight, taillight, interior, blackTrim };
}

/**
 * Brightens or dims one car's own tail lights. Acts only on the material set passed in, so
 * braking never lights another car's tail lights sharing the same scene (user decision).
 */
export function setBrakeLights(materials: CarMaterialSet, braking: boolean): void {
  materials.taillight.emissiveIntensity = braking
    ? TAILLIGHT_BRAKE_EMISSIVE_INTENSITY
    : TAILLIGHT_IDLE_EMISSIVE_INTENSITY;
}
