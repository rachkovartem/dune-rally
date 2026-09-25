// src/render/renderer.ts
import * as THREE from 'three';
import { buildSkyEnvironment } from './sky';
import { createSunShadows } from './sunShadows';
import { createPostPipeline } from './postPipeline';
import { createDevOverlay } from './devOverlay';
import { DEFAULT_QUALITY, QUALITY_TIERS, type QualityName, type QualityTier } from './qualityTiers';

// The drive prototype's fog colour, camera lens and clip plane.
const FOG_COLOR = 0xd9cfbc;
const CAMERA_FOV = 62;
const CAMERA_NEAR = 0.3;

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
  quality: () => QualityName;
  setQuality: (name: QualityName) => void;
  /** Called at once with the current tier, then on every change. */
  onQualityChange: (listener: (tier: QualityTier, name: QualityName) => void) => void;
  /** Detail lines of the `?debug=1` overlay; does nothing when the overlay is off. */
  showDebugLines: (lines: readonly string[]) => void;
}

export function createRenderer(canvas: HTMLCanvasElement, sky: SkyTextures): RenderContext {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The post pipeline tone-maps (AgX); a second tone map here would flatten the image.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  // The root never moves. Left on, its per-frame matrix update forces every object in the world to
  // recompute its world matrix, which was most of the main thread once the map filled with props.
  scene.matrixAutoUpdate = false;
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, QUALITY_TIERS[DEFAULT_QUALITY].cameraFar);
  camera.position.set(0, 30, 40);
  camera.lookAt(0, 0, 0);

  const { environment, sunDirection } = buildSkyEnvironment(renderer, sky.hdr);
  scene.environment = environment;
  scene.environmentIntensity = 1.0;
  sky.background.mapping = THREE.EquirectangularReflectionMapping;
  sky.background.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky.background;
  scene.backgroundIntensity = 1.0;
  const fog = new THREE.FogExp2(FOG_COLOR, QUALITY_TIERS[DEFAULT_QUALITY].fogDensity);
  scene.fog = fog;

  const sun = createSunShadows(scene, sunDirection);
  const post = createPostPipeline(renderer, scene, camera);
  const overlay = createDevOverlay('');

  let qualityName: QualityName = DEFAULT_QUALITY;
  const qualityListeners: ((tier: QualityTier, name: QualityName) => void)[] = [];

  function setQuality(name: QualityName): void {
    qualityName = name;
    const tier = QUALITY_TIERS[name];
    renderer.setPixelRatio(tier.pixelRatio);
    resize();
    sun.setQuality(tier.shadowMapSize, tier.shadowHalfExtent);
    fog.density = tier.fogDensity;
    camera.far = tier.cameraFar;
    camera.updateProjectionMatrix();
    post.setAmbientOcclusion(tier.ambientOcclusion);
    overlay?.setLabel(`renderer: webgl2 · quality ${name} (Q)`);
    for (const listener of qualityListeners) listener(tier, name);
  }

  function resize(): void {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    post.resize(width, height);
  }
  setQuality(DEFAULT_QUALITY);

  return {
    scene,
    camera,
    render: () => {
      post.render();
      overlay?.update();
    },
    resize,
    focusSun: sun.focusSun,
    environment,
    sunDirection,
    quality: () => qualityName,
    setQuality,
    onQualityChange: (listener) => {
      qualityListeners.push(listener);
      listener(QUALITY_TIERS[qualityName], qualityName);
    },
    showDebugLines: (lines) => overlay?.setDetails(lines),
  };
}
