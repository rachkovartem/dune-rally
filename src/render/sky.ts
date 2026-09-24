// src/render/sky.ts
import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

// Sun direction offset (light sits this far from its target, along the sun direction) — kept in
// sync with sunShadows.ts, which uses the same offset for the shadow-casting DirectionalLight.
export const SUN_OFFSET = new THREE.Vector3(60, 120, 40);
export const SUN_DIRECTION = SUN_OFFSET.clone().normalize();

/** A physical Preetham sky, tuned for a warm, hazy desert atmosphere. */
export function createSky(): SkyMesh {
  const sky = new SkyMesh();
  sky.scale.setScalar(3000);
  sky.turbidity.value = 2.5;
  sky.rayleigh.value = 1.0;
  sky.mieCoefficient.value = 0.004;
  sky.mieDirectionalG.value = 0.8;
  sky.sunPosition.value.copy(SUN_DIRECTION);
  sky.showSunDisc.value = true;
  return sky;
}

export interface SkyTextures {
  /** IBL irradiance/reflection source (`scene.environment`) — sun disc hidden so it doesn't blow
   * out the ambient light the whole scene reads from it. */
  environment: THREE.Texture;
  /** Visible backdrop (`scene.background`) — sun disc kept, so criterion 3's "visible sun" holds. */
  background: THREE.Texture;
}

/**
 * Bakes the sky into two PMREM cubemaps once at startup, instead of adding the `SkyMesh` itself
 * as scene geometry: a `WebGPURenderer` scene pass on this three.js version does not depth-test a
 * mesh-based sky against opaque objects correctly (verified: removing the mesh from the scene and
 * keeping only these baked textures removes a blue sky bleed-through seen on building walls and
 * dune slopes). A static backdrop also matches the spec — no day/night cycle, sun direction fixed.
 */
export function buildSkyTextures(renderer: THREE.Renderer, sky: SkyMesh): SkyTextures {
  const pmremScene = new THREE.Scene();
  pmremScene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);

  const wasSunDiscVisible = sky.showSunDisc.value;

  sky.showSunDisc.value = false;
  const environment = pmrem.fromScene(pmremScene, 0, 0.1, 5000).texture;

  sky.showSunDisc.value = true;
  const background = pmrem.fromScene(pmremScene, 0, 0.1, 5000).texture;

  sky.showSunDisc.value = wasSunDiscVisible;
  pmrem.dispose();
  pmremScene.remove(sky);

  return { environment, background };
}
