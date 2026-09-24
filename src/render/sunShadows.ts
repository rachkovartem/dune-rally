// src/render/sunShadows.ts
import * as THREE from 'three/webgpu';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { SUN_OFFSET } from './sky';
import type { QualityTier } from './quality';

export interface SunShadows {
  light: THREE.DirectionalLight;
  /** Keep the sun's shadow frustum centred on a world point (the player) so cascades stay crisp. */
  focusSun: (x: number, y: number, z: number) => void;
}

/** Sun light + cascaded shadow maps, sized from the quality tier. */
export function createSunShadows(scene: THREE.Scene, quality: QualityTier): SunShadows {
  const light = new THREE.DirectionalLight(0xfff2d6, 4.5);
  light.position.copy(SUN_OFFSET);
  light.castShadow = true;
  light.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 340;
  light.shadow.bias = -0.0006;
  light.shadow.normalBias = 1.2;

  const csm = new CSMShadowNode(light, {
    cascades: quality.csmCascades,
    maxFar: 240,
    mode: 'practical',
    lightMargin: 120,
  });
  csm.fade = true;
  light.shadow.shadowNode = csm;

  scene.add(light);
  scene.add(light.target);

  function focusSun(x: number, y: number, z: number): void {
    light.target.position.set(x, y, z);
    light.position.set(x + SUN_OFFSET.x, y + SUN_OFFSET.y, z + SUN_OFFSET.z);
  }

  return { light, focusSun };
}
