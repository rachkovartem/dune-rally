// src/main.ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createRenderer } from './render/renderer';
import { makeToonMaterial } from './render/celShading';
import { resolveSeed } from './world/seed';
import { TerrainManager } from './world/terrainManager';
import { initPhysics, addChunkCollider, removeCollider } from './physics/physicsWorld';

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

  // Drop test: a sphere falls and should rest on the terrain.
  const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(32, 80, 32));
  world.createCollider(RAPIER.ColliderDesc.ball(2), ballBody);
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 16), makeToonMaterial(0x4dd2ff));
  ctx.scene.add(ballMesh);

  terrain.update(32, 32, 3);
  ctx.camera.position.set(32, 60, 110);

  function loop() {
    world.step();
    const p = ballBody.translation();
    ballMesh.position.set(p.x, p.y, p.z);
    ctx.camera.lookAt(p.x, p.y, p.z);
    ctx.render();
    requestAnimationFrame(loop);
  }
  loop();
})();
