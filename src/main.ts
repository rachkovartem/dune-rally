import { createRenderer } from './render/renderer';
import { resolveSeed } from './world/seed';
import { createHeightField } from './world/noise';
import { generateChunkHeights } from './world/heightfieldData';
import { chunkOrigin, chunksInRadius } from './world/chunk';
import { buildTerrainMesh } from './render/terrainMesh';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const ctx = createRenderer(canvas);
window.addEventListener('resize', ctx.resize);

const seed = resolveSeed(window.location.href, '2026-06-19');
const height = createHeightField(seed);

for (const c of chunksInRadius({ cx: 0, cz: 0 }, 1)) {
  const grid = generateChunkHeights(height, c);
  const origin = chunkOrigin(c);
  ctx.scene.add(buildTerrainMesh(grid, origin.x, origin.z));
}

ctx.camera.position.set(32, 90, 140);
ctx.camera.lookAt(32, 0, 32);

function loop() {
  ctx.render();
  requestAnimationFrame(loop);
}
loop();
