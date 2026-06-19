// src/main.ts
import { createRenderer } from './render/renderer';
import { createHeightField } from './world/noise';
import { TerrainManager } from './world/terrainManager';
import { initPhysics, addChunkCollider, removeCollider } from './physics/physicsWorld';
import { Buggy } from './vehicle/buggy';
import { Keyboard } from './input/keyboard';
import { controlsFromKeys } from './input/controls';
import { ChaseCamera } from './render/chaseCamera';
import { connectToArena } from './net/connection';
import { PlayerViews } from './net/playerViews';
import { sanitizeInput, SERVER_PORT } from '../shared/protocol';
import type RAPIER from '@dimforge/rapier3d-compat';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const ctx = createRenderer(canvas);
window.addEventListener('resize', ctx.resize);

const conn = await connectToArena(`ws://${location.hostname}:${SERVER_PORT}`, 'rider');
const heightField = createHeightField(conn.seed);

// The local player's buggy is simulated LOCALLY at 60fps for smooth, instant control; inputs are
// also sent to the server so other players see us. The server stays authoritative for everyone
// else (full prediction + reconciliation that ties the two together is Plan 2b).
const world = await initPhysics();
const colliders = new Map<string, RAPIER.Collider>();
const terrain = new TerrainManager(conn.seed, ctx.scene, {
  onLoad: (key, heights, ox, oz) => colliders.set(key, addChunkCollider(world, heights, ox, oz)),
  onUnload: (key) => {
    const c = colliders.get(key);
    if (c) { removeCollider(world, c); colliders.delete(key); }
  },
});

const mePlayer = conn.players().get(conn.sessionId);
const spawnX = mePlayer?.x ?? 32;
const spawnZ = mePlayer?.z ?? 32;
terrain.update(spawnX, spawnZ, 3); // request colliders around the spawn before the buggy drops
// Spawn well above the surface so the async terrain colliders have loaded by the time it lands
// on its wheels (a too-low spawn lands on the chassis belly → wheels never grip).
const spawn = { x: spawnX, y: heightField(spawnX, spawnZ) + 8, z: spawnZ };
const buggy = new Buggy(world, ctx.scene, spawn);

const views = new PlayerViews(ctx.scene); // remote players only
const keyboard = new Keyboard();
const chase = new ChaseCamera(ctx.camera, heightField);
const playerCountEl = document.getElementById('player-count');
const speedEl = document.getElementById('speed');

const addRemote = (id: string) => { if (id !== conn.sessionId) views.add(id); };
for (const [id] of conn.players()) addRemote(id);
conn.onAdd(addRemote);
conn.onRemove((id) => views.remove(id));

const startEl = document.getElementById('start');
startEl?.addEventListener('click', () => {
  startEl.style.display = 'none';
  window.focus();
});

// R flips the buggy back upright (recover from a roll).
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') buggy.reset();
});

const STEP = world.timestep;
let last = performance.now() / 1000;
let acc = 0;

function frame() {
  const nowS = performance.now() / 1000;
  acc += Math.min(nowS - last, 0.1); // clamp after a tab pause
  last = nowS;
  const now = performance.now();

  const controls = controlsFromKeys(keyboard.keys);
  conn.sendInput(sanitizeInput(controls)); // server (for other players)

  while (acc >= STEP) {
    buggy.applyControls(controls);
    world.step();
    buggy.update();
    acc -= STEP;
  }

  // Remote players from the server, interpolated a little in the past.
  const renderTime = now - 1000 / 10;
  for (const [id, p] of conn.players()) {
    if (id !== conn.sessionId) views.pushState(id, p, now);
  }
  views.update(renderTime, null, renderTime);

  const p = buggy.position();
  terrain.update(p.x, p.z, 3);
  chase.update(buggy.mesh);

  if (playerCountEl) playerCountEl.textContent = String(conn.players().size);
  if (speedEl) speedEl.textContent = String(Math.round(buggy.speed() * 3.6));

  ctx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
