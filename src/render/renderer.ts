// src/render/renderer.ts
import * as THREE from 'three';
import { buildSkyEnvironment } from './sky';
import { createSunShadows } from './sunShadows';
import { createPostPipeline } from './postPipeline';
import { createDevOverlay } from './devOverlay';

export const PIXEL_RATIO_CAP = 1.5;

// Linear fog must be fully opaque before the edge of the streamed terrain (chunk radius 5 ≈ 320 m),
// or the edge of the world shows against the sky.
const FOG_NEAR = 140;
const FOG_FAR = 300;

export interface SkyTextures {
  /** The goegap HDR, decoded as FloatType: lighting, sun direction and fog colour. */
  hdr: THREE.DataTexture;
  /** The tonemapped goegap sky image shown behind the world. */
  background: THREE.Texture;
}

export interface RenderContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  render: () => void;
  resize: () => void;
  /** Keep the sun's shadow box centred on a world point (the player). */
  focusSun: (x: number, y: number, z: number) => void;
  /** The prefiltered HDR environment, the same texture as `scene.environment`. */
  environment: THREE.Texture;
  /** Unit vector toward the sun disc in the HDR. */
  sunDirection: THREE.Vector3;
}

export function createRenderer(canvas: HTMLCanvasElement, sky: SkyTextures): RenderContext {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The post pipeline tone-maps (AgX); a second tone map here would flatten the image.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  camera.position.set(0, 30, 40);
  camera.lookAt(0, 0, 0);

  const { environment, sunDirection, horizonColor } = buildSkyEnvironment(renderer, sky.hdr);
  scene.environment = environment;
  scene.environmentIntensity = 1.0;
  sky.background.mapping = THREE.EquirectangularReflectionMapping;
  sky.background.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky.background;
  scene.backgroundIntensity = 1.0;
  scene.fog = new THREE.Fog(horizonColor, FOG_NEAR, FOG_FAR);

  const { focusSun } = createSunShadows(scene, sunDirection);
  const post = createPostPipeline(renderer, scene, camera);
  const overlay = createDevOverlay('renderer: webgl2');

  function resize(): void {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    post.resize(width, height);
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
    environment,
    sunDirection,
  };
}
