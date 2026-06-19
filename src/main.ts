// src/main.ts
import { createRenderer } from './render/renderer';
import { createHeightField } from './world/noise';
import { TerrainManager } from './world/terrainManager';
import { Keyboard } from './input/keyboard';
import { controlsFromKeys } from './input/controls';
import { ChaseCamera } from './render/chaseCamera';
import { connectToArena } from './net/connection';
import { PlayerViews } from './net/playerViews';
import { sanitizeInput, SERVER_PORT } from '../shared/protocol';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const ctx = createRenderer(canvas);
window.addEventListener('resize', ctx.resize);

const serverUrl = `ws://${location.hostname}:${SERVER_PORT}`;
const conn = await connectToArena(serverUrl, 'rider');

// Terrain visuals use the server's seed so every client renders the same arena.
const heightField = createHeightField(conn.seed);
const terrain = new TerrainManager(conn.seed, ctx.scene, undefined);

const views = new PlayerViews(ctx.scene);
const keyboard = new Keyboard();
const chase = new ChaseCamera(ctx.camera, heightField);

// Mirror server players into views.
for (const [id] of conn.players()) views.add(id);
conn.onAdd((id) => views.add(id));
conn.onRemove((id) => views.remove(id));

function frame() {
  const now = performance.now();

  // send input
  conn.sendInput(sanitizeInput(controlsFromKeys(keyboard.keys)));

  // push latest server transforms into interpolation buffers
  for (const [id, p] of conn.players()) views.pushState(id, p, now);

  // render slightly in the past for smooth interpolation
  const renderTime = now - 1000 / 10;
  views.update(renderTime);

  const me = views.group(conn.sessionId);
  if (me) {
    terrain.update(me.position.x, me.position.z, 3);
    chase.update(me);
  }
  ctx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
