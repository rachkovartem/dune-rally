// src/render/renderer.ts
import * as THREE from 'three/webgpu';
import { backendKindOf, type BackendFlag, type BackendKind } from './backend';
import { selectQuality, type QualityTier } from './quality';
import { createSky, buildSkyTextures, SUN_DIRECTION } from './sky';
import { createSunShadows } from './sunShadows';
import { createPostPipeline } from './postPipeline';
import { createDevOverlay } from './devOverlay';

export interface RenderContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  render: () => void;
  resize: () => void;
  /** Keep the sun's shadow frustum centred on a world point (the player) so shadows stay crisp. */
  focusSun: (x: number, y: number, z: number) => void;
  backendKind: BackendKind;
  quality: QualityTier;
  /** Baked sky IBL — the same texture `scene.environment` uses, for materials built outside
   * `createRenderer` (water, terrain, props) that need it at construction time. */
  environment: THREE.Texture;
  /** Fixed sun direction (no day/night cycle), shared by the water and terrain sparkle/glint. */
  sunDirection: THREE.Vector3;
}

// Tuned by eye against the desert screenshots rather than sampled from the sky shader at
// startup — a real GPU readback would add async complexity for a colour that is retuned visually
// anyway (see the report's Notes on this simplification).
const HORIZON_COLOR = new THREE.Color(0xdba066);

export async function createRenderer(
  canvas: HTMLCanvasElement,
  backendFlag: BackendFlag,
): Promise<RenderContext> {
  const forceWebGL = backendFlag === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  await renderer.init();

  const backendKind = backendKindOf(renderer);
  const quality = selectQuality(backendKind, window.devicePixelRatio);

  renderer.setPixelRatio(quality.pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.7;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON_COLOR, 110, 290);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  camera.position.set(0, 30, 40);
  camera.lookAt(0, 0, 0);

  const sky = createSky();
  const { environment, background } = buildSkyTextures(renderer, sky);
  scene.environment = environment;
  scene.environmentIntensity = 0.1;
  scene.background = background;

  const { focusSun } = createSunShadows(scene, quality);

  const post = createPostPipeline(renderer, scene, camera, quality);
  const overlay = createDevOverlay(backendKind);

  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.resize();
  }
  resize();

  return {
    scene,
    camera,
    render: () => {
      post.render();
      overlay?.update();
    },
    resize,
    focusSun,
    backendKind,
    quality,
    environment,
    sunDirection: SUN_DIRECTION,
  };
}
