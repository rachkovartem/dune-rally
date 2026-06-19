// src/main.ts
import { createRenderer } from './render/renderer';
import { resolveSeed } from './world/seed';
import { TerrainManager } from './world/terrainManager';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const ctx = createRenderer(canvas);
window.addEventListener('resize', ctx.resize);

const seed = resolveSeed(window.location.href, '2026-06-19');
const terrain = new TerrainManager(seed, ctx.scene);

// Temporary fly-around to prove streaming: move the focus point in a circle.
let t = 0;
ctx.camera.position.set(0, 120, 160);
function loop() {
  t += 0.003;
  const px = Math.cos(t) * 200;
  const pz = Math.sin(t) * 200;
  terrain.update(px, pz, 3);
  ctx.camera.lookAt(px, 0, pz);
  ctx.render();
  requestAnimationFrame(loop);
}
loop();
