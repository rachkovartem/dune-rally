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
  sky.turbidity.value = 4;
  sky.rayleigh.value = 1.8;
  sky.mieCoefficient.value = 0.006;
  sky.mieDirectionalG.value = 0.82;
  sky.sunPosition.value.copy(SUN_DIRECTION);
  sky.showSunDisc.value = true;
  return sky;
}

/**
 * Bakes the sky into an IBL environment map once at startup. The sun disc is hidden while baking
 * so it doesn't blow out the irradiance the whole scene reads its ambient light from.
 */
export function buildEnvironment(renderer: THREE.Renderer, sky: SkyMesh): THREE.Texture {
  const pmremScene = new THREE.Scene();
  pmremScene.add(sky);

  const wasSunDiscVisible = sky.showSunDisc.value;
  sky.showSunDisc.value = false;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(pmremScene, 0, 0.1, 5000);
  pmrem.dispose();

  sky.showSunDisc.value = wasSunDiscVisible;
  pmremScene.remove(sky);

  return target.texture;
}
