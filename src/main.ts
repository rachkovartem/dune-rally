// src/main.ts
import { createRenderer } from './render/renderer';
import { resolveSeed } from './world/seed';
import { TerrainManager } from './world/terrainManager';
import { initPhysics, addChunkCollider, removeCollider } from './physics/physicsWorld';
import { Buggy } from './vehicle/buggy';
import { Keyboard } from './input/keyboard';
import { controlsFromKeys } from './input/controls';
import { ChaseCamera } from './render/chaseCamera';
import RAPIER from '@dimforge/rapier3d-compat';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const ctx = createRenderer(canvas);
window.addEventListener('resize', ctx.resize);

const seed = resolveSeed(window.location.href, '2026-06-19');
const world = await initPhysics();

const colliders = new Map<string, RAPIER.Collider>();
const terrain = new TerrainManager(seed, ctx.scene, {
  onLoad: (key, heights, ox, oz) => colliders.set(key, addChunkCollider(world, heights, ox, oz)),
  onUnload: (key) => {
    const c = colliders.get(key);
    if (c) { removeCollider(world, c); colliders.delete(key); }
  },
});

const buggy = new Buggy(world, ctx.scene, { x: 32, y: 30, z: 32 });
const keyboard = new Keyboard();
const chase = new ChaseCamera(ctx.camera);

// Fixed-step physics with an accumulator; render every animation frame.
const STEP = world.timestep;
let last = performance.now() / 1000;
let acc = 0;

function frame() {
  const now = performance.now() / 1000;
  acc += Math.min(now - last, 0.1); // clamp to avoid spiral-of-death after a tab pause
  last = now;

  const controls = controlsFromKeys(keyboard.keys);
  while (acc >= STEP) {
    buggy.applyControls(controls);
    world.step();
    buggy.update();
    acc -= STEP;
  }

  const p = buggy.position();
  terrain.update(p.x, p.z, 3);
  chase.update(buggy.mesh);
  ctx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
