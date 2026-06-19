import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  render: () => void;
  resize: () => void;
  /** Keep the sun's shadow frustum centred on a world point (the player) so shadows stay crisp. */
  focusSun: (x: number, y: number, z: number) => void;
}

// Sun direction offset (light sits this far from its target, along the sun direction).
const SUN_OFFSET = new THREE.Vector3(60, 120, 40);

export function createRenderer(canvas: HTMLCanvasElement): RenderContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Borderlands-style ink outlines.
  const outline = new OutlineEffect(renderer, {
    defaultThickness: 0.004,
    defaultColor: [0, 0, 0],
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2c879); // hazy desert sky
  scene.fog = new THREE.Fog(0xf2c879, 220, 480);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  camera.position.set(0, 30, 40);
  camera.lookAt(0, 0, 0);

  // Key light (sun) casts real shadows; a hemisphere fill keeps shadowed faces warm, not black.
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.9);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = -26;
  cam.right = 26;
  cam.top = 26;
  cam.bottom = -26;
  cam.near = 1;
  cam.far = 340;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 1.2;
  scene.add(sun);
  scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(0xffe9c0, 0x8a6a44, 1.0));

  function focusSun(x: number, y: number, z: number) {
    sun.target.position.set(x, y, z);
    sun.position.set(x + SUN_OFFSET.x, y + SUN_OFFSET.y, z + SUN_OFFSET.z);
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  return {
    renderer,
    scene,
    camera,
    render: () => outline.render(scene, camera),
    resize,
    focusSun,
  };
}
