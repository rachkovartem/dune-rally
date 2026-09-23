// src/main.ts
import { createRenderer } from './render/renderer';
import { createHeightField } from './world/noise';
import { createBiome } from './world/biome';
import { terrainSurfaceHeight } from './world/chunkGeometry';
import { CHUNK_SIZE } from './world/chunk';
import { featuresInChunk, SPAWN } from './world/worldDef';
import { TerrainManager } from './world/terrainManager';
import { initPhysics, addChunkCollider, addFeatureColliders, removeCollider } from './physics/physicsWorld';
import { Buggy } from './vehicle/buggy';
import { Keyboard } from './input/keyboard';
import { controlsFromKeys } from './input/controls';
import { ChaseCamera } from './render/chaseCamera';
import { connectToArena } from './net/connection';
import { PlayerViews } from './net/playerViews';
import { TireTracks } from './render/groundDecals';
import { Water } from './render/water';
import { Knockables } from './render/knockables';
import { AudioManager } from './audio/audio';
import { sanitizeInput, SERVER_PORT } from '../shared/protocol';
import type RAPIER from '@dimforge/rapier3d-compat';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const ctx = createRenderer(canvas);
window.addEventListener('resize', ctx.resize);
const audio = new AudioManager();

const conn = await connectToArena(`ws://${location.hostname}:${SERVER_PORT}`, 'rider');
const heightField = createHeightField(conn.seed);
const biome = createBiome(conn.seed);
const knockables = new Knockables(() => audio.knock());

// The local player's buggy is simulated LOCALLY at 60fps for smooth, instant control; inputs are
// also sent to the server so other players see us. The server stays authoritative for everyone
// else (full prediction + reconciliation that ties the two together is Plan 2b).
const world = await initPhysics();
const colliders = new Map<string, RAPIER.Collider>();
const featureColliders = new Map<string, RAPIER.Collider[]>();
const terrain = new TerrainManager(conn.seed, ctx.scene, biome, heightField, knockables, {
  onLoad: (key, heights, ox, oz) => {
    colliders.set(key, addChunkCollider(world, heights, ox, oz));
    const cx = Math.round(ox / CHUNK_SIZE);
    const cz = Math.round(oz / CHUNK_SIZE);
    const cols = addFeatureColliders(world, featuresInChunk(cx, cz), heightField);
    if (cols.length) featureColliders.set(key, cols);
  },
  onUnload: (key) => {
    const c = colliders.get(key);
    if (c) { removeCollider(world, c); colliders.delete(key); }
    const fc = featureColliders.get(key);
    if (fc) { for (const col of fc) removeCollider(world, col); featureColliders.delete(key); }
  },
});

// Spawn the local car at the authored town plaza. (The server places each player on a small
// spawn spiral there too; with no reconciliation yet, the local car is what our own camera follows.)
const spawnX = SPAWN.x;
const spawnZ = SPAWN.z;
terrain.update(spawnX, spawnZ, 4); // request colliders around the spawn before the buggy drops
// Spawn well above the surface so the async terrain colliders have loaded by the time it lands
// on its wheels (a too-low spawn lands on the chassis belly → wheels never grip).
const spawn = { x: spawnX, y: heightField(spawnX, spawnZ) + 8, z: spawnZ };
const buggy = new Buggy(world, ctx.scene, spawn);

const views = new PlayerViews(ctx.scene); // remote players only
const keyboard = new Keyboard();
// TEMP debug hook
(window as unknown as { __dbg: () => unknown }).__dbg = () => {
  const p = buggy.position();
  return {
    pos: { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1) },
    speed: +buggy.speed().toFixed(2),
    ...buggy.debug(),
    keys: [...keyboard.keys],
  };
};
(window as unknown as { __tp: (x: number, z: number) => void }).__tp = (x, z) =>
  buggy.teleport(x, heightField(x, z) + 3, z);
const chase = new ChaseCamera(ctx.camera, heightField);
const tracks = new TireTracks(ctx.scene, heightField);
const water = new Water(ctx.scene, biome.waterLevel);
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
  audio.resume(); // user gesture → unlock audio
  audio.ui();
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
  const dt = Math.min(nowS - last, 0.1); // clamp after a tab pause
  acc += dt;
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
  terrain.update(p.x, p.z, 4);
  tracks.update(buggy.mesh, buggy.speed());
  water.update(p.x, p.z);
  ctx.focusSun(p.x, p.y, p.z);
  chase.update(buggy.mesh);

  // knock over trees/cacti the car ploughs through (fall toward travel direction)
  const cq = buggy.mesh.quaternion;
  const fwdX = 2 * (cq.x * cq.z + cq.w * cq.y);
  const fwdZ = 1 - 2 * (cq.x * cq.x + cq.y * cq.y);
  knockables.update(p.x, p.z, fwdX, fwdZ, buggy.speed(), dt);

  // tyre sound matched to the surface under the car
  const sh = terrainSurfaceHeight(heightField, p.x, p.z);
  const sd = 1.5;
  const slope = Math.hypot(
    terrainSurfaceHeight(heightField, p.x + sd, p.z) - terrainSurfaceHeight(heightField, p.x - sd, p.z),
    terrainSurfaceHeight(heightField, p.x, p.z + sd) - terrainSurfaceHeight(heightField, p.x, p.z - sd),
  ) / (2 * sd);
  audio.setSurface(biome.coverAt(p.x, p.z, sh, slope));
  audio.setDrive(buggy.speed(), controls.throttle);

  if (playerCountEl) playerCountEl.textContent = String(conn.players().size);
  if (speedEl) speedEl.textContent = String(Math.round(buggy.speed() * 3.6));

  ctx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
