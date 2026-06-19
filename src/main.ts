import * as THREE from 'three';
import { createRenderer } from './render/renderer';
import { makeToonMaterial } from './render/celShading';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const ctx = createRenderer(canvas);
window.addEventListener('resize', ctx.resize);

const cube = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), makeToonMaterial(0xff8a3d));
ctx.scene.add(cube);

function loop() {
  cube.rotation.y += 0.01;
  cube.rotation.x += 0.005;
  ctx.render();
  requestAnimationFrame(loop);
}
loop();
