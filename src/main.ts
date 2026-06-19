// src/main.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { createRenderer } from './render/renderer';
import { resolveSeed } from './world/seed';
import { TerrainManager } from './world/terrainManager';
import { initPhysics, addChunkCollider, removeCollider } from './physics/physicsWorld';
import { Buggy } from './vehicle/buggy';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const ctx = createRenderer(canvas);
window.addEventListener('resize', ctx.resize);

const seed = resolveSeed(window.location.href, '2026-06-19');

(async () => {
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
  terrain.update(32, 32, 3);

  function loop() {
    buggy.applyControls({ throttle: 0, brake: 0, steer: 0 }); // no input yet (Task 13)
    world.step();
    buggy.update();
    const p = buggy.position();
    terrain.update(p.x, p.z, 3);
    ctx.camera.position.set(p.x, p.y + 25, p.z + 45);
    ctx.camera.lookAt(p.x, p.y, p.z);
    ctx.render();
    requestAnimationFrame(loop);
  }
  loop();
})();
