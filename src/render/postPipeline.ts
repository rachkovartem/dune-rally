// src/render/postPipeline.ts
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, velocity, renderOutput } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import type { QualityTier } from './quality';

export interface PostPipeline {
  render: () => void;
  resize: () => void;
}

/**
 * One scene pass (MRT: colour + normal + velocity) feeding GTAO, optional bloom, and either TRAA
 * (WebGPU) or FXAA (WebGL2 fallback) — see the plan's Tech Decisions for why a single MRT pass
 * replaces a normal/depth pre-pass.
 */
export function createPostPipeline(
  renderer: THREE.Renderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualityTier,
): PostPipeline {
  const pipeline = new THREE.RenderPipeline(renderer);

  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView, velocity }));

  const scenePassColor = scenePass.getTextureNode('output');
  const scenePassNormal = scenePass.getTextureNode('normal');
  const scenePassDepth = scenePass.getTextureNode('depth');

  const aoPass = ao(scenePassDepth, scenePassNormal, camera);
  aoPass.resolutionScale = quality.aoResolutionScale;

  let colorNode = scenePassColor.mul(aoPass.getTextureNode().r);
  if (quality.bloom) {
    colorNode = colorNode.add(bloom(scenePassColor, 0.28, 0.45, 1.0));
  }

  if (quality.antialias === 'traa') {
    const scenePassVelocity = scenePass.getTextureNode('velocity');
    pipeline.outputNode = traa(colorNode, scenePassDepth, scenePassVelocity, camera);
  } else {
    // FXAA needs sRGB, tone-mapped input, so tonemap/colour-space runs here instead of letting
    // the pipeline's default output stage do it after — see RenderPipeline.js's own note on this.
    pipeline.outputColorTransform = false;
    pipeline.outputNode = fxaa(renderOutput(colorNode));
  }

  return {
    render: () => pipeline.render(),
    resize: () => { pipeline.needsUpdate = true; },
  };
}
