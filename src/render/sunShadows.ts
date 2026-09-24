// src/render/sunShadows.ts
import * as THREE from 'three';

export interface SunShadowSettings {
  mapSize: number;
  blurSamples: number;
  radius: number;
  /** Half the side of the square shadow box around the player, in metres. */
  halfExtent: number;
}

// The drive prototype's values. 4096 px with 12 samples looked the same at chase-cam distance and
// cost about half the frame-rate headroom at pixel ratio 1.5.
export const SUN_SHADOW_SETTINGS: SunShadowSettings = {
  mapSize: 2048,
  blurSamples: 8,
  radius: 5,
  halfExtent: 45,
};

const SUN_COLOR = 0xfff2e0;
const SUN_INTENSITY = 5.0;
const SUN_DISTANCE = 200;

export interface SunShadows {
  light: THREE.DirectionalLight;
  /** Keeps the shadow box centred on a world point (the player). */
  focusSun: (x: number, y: number, z: number) => void;
}

/** Rounds a value to the nearest multiple of one shadow-map texel. */
export function snapToTexel(value: number, texelSize: number): number {
  if (!(texelSize > 0)) throw new Error(`snapToTexel: texel size must be positive, got ${texelSize}.`);
  return Math.round(value / texelSize) * texelSize;
}

/** The sun as a DirectionalLight with one VSM shadow map in a box that follows the player. */
export function createSunShadows(
  scene: THREE.Scene,
  sunDirection: THREE.Vector3,
  settings: SunShadowSettings = SUN_SHADOW_SETTINGS,
): SunShadows {
  const light = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  light.castShadow = true;
  light.shadow.mapSize.set(settings.mapSize, settings.mapSize);
  const shadowCamera = light.shadow.camera;
  shadowCamera.near = 50;
  shadowCamera.far = 400;
  shadowCamera.left = -settings.halfExtent;
  shadowCamera.right = settings.halfExtent;
  shadowCamera.top = settings.halfExtent;
  shadowCamera.bottom = -settings.halfExtent;
  shadowCamera.updateProjectionMatrix();
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.03;
  light.shadow.radius = settings.radius;
  light.shadow.blurSamples = settings.blurSamples;
  scene.add(light, light.target);

  // The shadow camera looks along -sunDirection with world up, so these are its screen axes.
  // Snapping the target along them keeps each texel on the same ground spot while the car
  // moves, which removes the shadow-edge crawl.
  const towardSun = sunDirection.clone().normalize();
  const shadowRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), towardSun).normalize();
  const shadowUp = new THREE.Vector3().crossVectors(towardSun, shadowRight).normalize();
  const texelSize = (settings.halfExtent * 2) / settings.mapSize;
  const focus = new THREE.Vector3();

  function focusSun(x: number, y: number, z: number): void {
    focus.set(x, y, z);
    const alongRight = snapToTexel(focus.dot(shadowRight), texelSize);
    const alongUp = snapToTexel(focus.dot(shadowUp), texelSize);
    const alongSun = focus.dot(towardSun);
    light.target.position
      .copy(shadowRight).multiplyScalar(alongRight)
      .addScaledVector(shadowUp, alongUp)
      .addScaledVector(towardSun, alongSun);
    light.target.updateMatrixWorld();
    light.position.copy(light.target.position).addScaledVector(towardSun, SUN_DISTANCE);
  }

  return { light, focusSun };
}
