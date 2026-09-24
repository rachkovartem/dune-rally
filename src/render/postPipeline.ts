// src/render/postPipeline.ts
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  SMAAEffect, SMAAPreset,
} from 'postprocessing';

export interface PostPipeline {
  render: () => void;
  /** Sizes the renderer and every pass; takes CSS pixels, the renderer applies its pixel ratio. */
  resize: (width: number, height: number) => void;
}

/**
 * Scene pass → bloom + AgX tone mapping → SMAA, the recipe the spike was accepted with. The
 * bloom threshold of 1.0 sits above lit sand and sky, so only emissive lights bloom. No
 * screen-space AO: the spike measured it at about 7 fps for almost no visible gain outdoors.
 */
export function createPostPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostPipeline {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(
    camera,
    new BloomEffect({ intensity: 0.25, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 }),
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
  ));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

  return {
    render: () => composer.render(),
    resize: (width, height) => composer.setSize(width, height, false),
  };
}
