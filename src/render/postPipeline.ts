// src/render/postPipeline.ts
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  SMAAEffect, SMAAPreset,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export interface PostPipeline {
  render: () => void;
  /** Sizes the renderer and every pass; takes CSS pixels, the renderer applies its pixel ratio. */
  resize: (width: number, height: number) => void;
  setAmbientOcclusion: (enabled: boolean) => void;
}

/**
 * Scene pass → N8AO contact shadows (high tier only) → bloom + AgX tone mapping → SMAA, the drive
 * prototype's recipe value for value. The bloom threshold of 1.0 sits above lit sand and sky, so
 * only emissive lights bloom.
 */
export function createPostPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostPipeline {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  const ambientOcclusion = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
  Object.assign(ambientOcclusion.configuration, {
    aoRadius: 1.5, distanceFalloff: 1.0, intensity: 3.0, halfRes: true, screenSpaceRadius: false, gammaCorrection: false,
  });
  ambientOcclusion.setQualityMode('Medium');
  composer.addPass(ambientOcclusion);
  composer.addPass(new EffectPass(
    camera,
    new BloomEffect({ intensity: 0.25, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 }),
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
  ));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

  return {
    render: () => composer.render(),
    resize: (width, height) => composer.setSize(width, height, false),
    setAmbientOcclusion: (enabled) => { ambientOcclusion.enabled = enabled; },
  };
}
