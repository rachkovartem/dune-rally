// src/main.ts
import { createRenderer } from './render/renderer';
import { loadAssets } from './assets/loadAssets';
import { createHeightField } from './world/noise';
import { createBiome } from './world/biome';
import { surfaceSampleAt } from './world/surfaceSample';
import { CHUNK_SIZE } from './world/chunk';
import { featuresInChunk, SPAWN } from './world/worldDef';
import { TerrainManager } from './world/terrainManager';
import { initPhysics, addChunkCollider, addFeatureColliders, removeCollider } from './physics/physicsWorld';
import { Buggy } from './vehicle/buggy';
import { vehicleConfigFor } from './vehicle/vehicleConfig';
import type { CarId } from './vehicle/cars';
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
import { carDefinitionFor } from './assets/carCatalog';
import { assembleCar, fitCarToChassis } from './render/carModel';
import { registerCarAsset, getCarMaterials } from './render/buggyMesh';
import { setBrakeLights } from './render/carMaterials';
import type { AssetManifestEntry, LoadedAssets } from './assets/loadAssets';
import { PROP_TEXTURE_SETS, type PropKind } from './assets/textureManifest';
import { createTerrainMaterial } from './render/terrainMaterial';
import { setTerrainMaterial } from './render/terrainMesh';
import { createPropMaterials } from './render/propMaterials';
import { setPropMaterials } from './render/scatter';
import { SRGBColorSpace, RepeatWrapping, type DataTexture, type Group, type Texture } from 'three';

const canvas = document.getElementById('app');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Expected a <canvas id="app"> element in the page.');
}
const audio = new AudioManager();

const conn = await connectToArena(`ws://${location.hostname}:${SERVER_PORT}`, 'rider');
const heightField = createHeightField(conn.seed);
const biome = createBiome(conn.seed);
const knockables = new Knockables(() => audio.knock());

// The car picker replaces this fixed choice in C2.
const localCarId: CarId = 'pajero';
const localCar = carDefinitionFor(localCarId);
const localCarConfig = vehicleConfigFor(localCarId);

// One manifest and one progress readout for the sky, the ground and prop textures, and the car.
// Any failed file stops the game with its message in the start overlay: there is no fallback
// sky or car, so a missing file cannot hide behind a look that almost works.
const SKY_HDR_URL = '/sky/goegap_1k.hdr';
const SKY_BACKGROUND_URL = '/sky/goegap_sky_4k.webp';
const SAND_SET_ID = 'Ground054';
const manifest: AssetManifestEntry[] = [
  { id: 'sky-hdr', kind: 'hdr', url: SKY_HDR_URL },
  { id: 'sky-background', kind: 'texture', url: SKY_BACKGROUND_URL },
  { id: 'car:pajero', kind: 'model', url: localCar.modelUrl },
];
const addedTextureUrls = new Set<string>();
const addTexture = (id: string, url: string): void => {
  if (addedTextureUrls.has(url)) return;
  addedTextureUrls.add(url);
  manifest.push({ id, kind: 'texture', url });
};
for (const map of ['color', 'normal', 'arm']) addTexture(`${SAND_SET_ID}-${map}`, `/textures/${SAND_SET_ID}/${map}.webp`);
for (const setId of Object.values(PROP_TEXTURE_SETS)) {
  addTexture(`${setId}-color`, `/textures/${setId}/color.webp`);
  addTexture(`${setId}-normal`, `/textures/${setId}/normal.webp`);
}

const startEl = document.getElementById('start');
const startGoEl = startEl?.querySelector<HTMLElement>('.start-go') ?? null;
const startSubEl = startEl?.querySelector<HTMLElement>('.start-sub') ?? null;
const startSubDefaultText = startSubEl?.textContent ?? '';
let assetsReady = false;
if (startSubEl) startSubEl.textContent = 'Загрузка… 0%';
let assets: LoadedAssets;
try {
  assets = await loadAssets(manifest, (fraction) => {
    if (startSubEl) startSubEl.textContent = `Загрузка… ${Math.round(fraction * 100)}%`;
  });
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  if (startSubEl) {
    startSubEl.textContent = `Ошибка загрузки: ${reason}`;
    startSubEl.style.color = '#ff6b5a';
  }
  throw error;
}

function loadedTexture(id: string): Texture {
  const found = assets.textures.get(id);
  if (!found) throw new Error(`Expected the "${id}" texture to be present in the loaded assets.`);
  return found;
}
function loadedHdr(id: string): DataTexture {
  const found = assets.hdrs.get(id);
  if (!found) throw new Error(`Expected the "${id}" HDR to be present in the loaded assets.`);
  return found;
}
function loadedModel(id: string): Group {
  const found = assets.models.get(id);
  if (!found) throw new Error(`Expected the "${id}" model to be present in the loaded assets.`);
  return found;
}
/** Colour maps hold sRGB bytes; normal and ARM maps hold linear data (the loader's default). */
function colorMap(id: string): Texture {
  const texture = loadedTexture(id);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const ctx = createRenderer(canvas, { hdr: loadedHdr('sky-hdr'), background: loadedTexture('sky-background') });
window.__render = { backend: 'webgl2' };
window.addEventListener('resize', ctx.resize);

const sandSet = {
  color: colorMap(`${SAND_SET_ID}-color`),
  normal: loadedTexture(`${SAND_SET_ID}-normal`),
  arm: loadedTexture(`${SAND_SET_ID}-arm`),
};
for (const texture of [sandSet.color, sandSet.normal, sandSet.arm]) {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
}
setTerrainMaterial(createTerrainMaterial(sandSet));

const propTextureSetFor = (kind: PropKind) => ({
  color: colorMap(`${PROP_TEXTURE_SETS[kind]}-color`),
  normal: loadedTexture(`${PROP_TEXTURE_SETS[kind]}-normal`),
});
setPropMaterials(createPropMaterials({
  rock: propTextureSetFor('rock'),
  bark: propTextureSetFor('bark'),
  stucco: propTextureSetFor('stucco'),
  roof: propTextureSetFor('roof'),
  metal: propTextureSetFor('metal'),
  wood: propTextureSetFor('wood'),
}));

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
terrain.update(spawnX, spawnZ, 5); // request colliders around the spawn before the buggy drops
// Spawn well above the surface so the async terrain colliders have loaded by the time it lands
// on its wheels (a too-low spawn lands on the chassis belly → wheels never grip).
const spawn = { x: spawnX, y: heightField(spawnX, spawnZ) + 8, z: spawnZ };

assetsReady = true;
if (startSubEl) startSubEl.textContent = startSubDefaultText;
if (startGoEl) startGoEl.style.display = '';

// Fit the loaded model to the physics chassis and register it once, before any car mesh (local
// or remote) is built.
const carFit = fitCarToChassis(localCar.measured, localCarConfig);
registerCarAsset(localCarId, assembleCar(loadedModel('car:pajero'), carFit, localCar.rules));

const buggy = new Buggy(world, ctx.scene, spawn, localCarId);

const views = new PlayerViews(ctx.scene); // remote players only
const keyboard = new Keyboard();
// TEMP debug hook
window.__dbg = () => {
  const p = buggy.position();
  return {
    pos: { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1) },
    speed: +buggy.speed().toFixed(2),
    ...buggy.debug(),
    keys: [...keyboard.keys],
  };
};
window.__tp = (x, z) => buggy.teleport(x, heightField(x, z) + 3, z);
const chase = new ChaseCamera(ctx.camera, heightField);
const tracks = new TireTracks(ctx.scene, heightField);
const water = new Water(ctx.scene, biome.waterLevel);
const playerCountEl = document.getElementById('player-count');
const speedEl = document.getElementById('speed');

const addRemote = (id: string) => { if (id !== conn.sessionId) views.add(id, 'pajero'); };
for (const [id] of conn.players()) addRemote(id);
conn.onAdd(addRemote);
conn.onRemove((id) => views.remove(id));

startEl?.addEventListener('click', () => {
  if (!assetsReady) return; // ignore clicks while the loading gate is still showing progress
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
  setBrakeLights(getCarMaterials(buggy.mesh), controls.brake > 0.1); // this car's own tail lights only

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
  terrain.update(p.x, p.z, 5);
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
  const surface = surfaceSampleAt(heightField, p.x, p.z);
  audio.setSurface(biome.coverAt(p.x, p.z, surface.height, surface.slope));
  audio.setDrive(buggy.speed(), controls.throttle, localCarConfig.maxSpeed);

  if (playerCountEl) playerCountEl.textContent = String(conn.players().size);
  if (speedEl) speedEl.textContent = String(Math.round(buggy.speed() * 3.6));

  ctx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
