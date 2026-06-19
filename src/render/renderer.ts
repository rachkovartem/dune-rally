import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  render: () => void;
  resize: () => void;
}

export function createRenderer(canvas: HTMLCanvasElement): RenderContext {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

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

  // Key light (sun) plus a hemisphere fill so shadowed faces pick up warm sky / sand bounce
  // instead of crushing to black — keeps the cel-shaded terrain readable and lively.
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.8);
  sun.position.set(60, 120, 40);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffe9c0, 0x8a6a44, 1.1));

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
  };
}
