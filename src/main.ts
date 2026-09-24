// src/main.ts
import { createRenderer } from './render/renderer';
import { loadAssets } from './assets/loadAssets';
import { createHeightField } from './world/noise';
import { createBiome } from './world/biome';
import { surfaceSampleAt } from './world/surfaceSample';
import { CHUNK_SIZE, chunkKey, chunkOrigin, chunksInRadius, worldToChunk, type ChunkCoord } from './world/chunk';
import { featuresInChunk, SPAWN } from './world/worldDef';
import { TerrainManager } from './world/terrainManager';
import { initPhysics, addChunkCollider, addFeatureColliders, addSolidPropColliders, removeCollider } from './physics/physicsWorld';
import { Buggy } from './vehicle/buggy';
import { vehicleConfigFor, type VehicleConfig } from './vehicle/vehicleConfig';
import { CAR_IDS, type CarId } from './vehicle/cars';
import { terrainSurfaceHeight } from './world/chunkGeometry';
import { Keyboard } from './input/keyboard';
import { controlsFromKeys } from './input/controls';
import { ChaseCamera } from './render/chaseCamera';
import { connectToArena, type NetPlayer } from './net/connection';
import { PlayerViews } from './net/playerViews';
import { TireTracks } from './render/groundDecals';
import { Water } from './render/water';
import { Knockables } from './render/knockables';
import { AudioManager, type RemoteCarPose } from './audio/audio';
import { sanitizeCarId, sanitizeInput, SERVER_PORT } from '../shared/protocol';
import { terrainGripFor } from '../shared/terrainGrip';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RESET_LIFT } from '../shared/vehiclePhysics';
import { carDefinitionFor, FORESTER_MODEL_MISSING_MESSAGE } from './assets/carCatalog';
import { assembleCar, fitCarToChassis } from './render/carModel';
import { registerCarAsset, getCarMaterials } from './render/buggyMesh';
import { setBrakeLights } from './render/carMaterials';
import { AssetLoadError, type AssetManifestEntry, type LoadedAssets } from './assets/loadAssets';
import { PROP_TEXTURE_SETS, type PropKind } from './assets/textureManifest';
import { createTerrainMaterial } from './render/terrainMaterial';
import { setTerrainMaterial } from './render/terrainMesh';
import { createPropMaterials } from './render/propMaterials';
import { setHighTierPropsVisible, setPropMaterials, updatePropVisibility } from './render/scatter';
import { boulderRockTexture, GRASS_MODEL_ID, POLY_PROP_IDS, polyPropUrl, registerPolyProps } from './render/polyProps';
import { Grass } from './render/grass';
import { otherQuality } from './render/qualityTiers';
import { SRGBColorSpace, RepeatWrapping, Object3D, Vector3, type DataTexture, type Group, type Texture } from 'three';
import { readSavedCarId, saveCarId } from './ui/carChoice';
import { createCarPicker } from './ui/carPicker';
import { createFrameGuard } from './debug/frameGuard';
import { debugModeEnabled } from './render/devOverlay';

const canvas = document.getElementById('app');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Expected a <canvas id="app"> element in the page.');
}
const audio = new AudioManager();
window.__audio = () => audio.snapshot();

const startEl = document.getElementById('start');
const carsEl = startEl?.querySelector<HTMLElement>('.start-cars');
if (!startEl || !carsEl) throw new Error('Expected the #start overlay with a .start-cars picker in the page.');
// Wired before connecting, so a choice made on the loading screen is not lost. The server hears
// every change at once, and other players see the right model before this player starts driving.
let announceCar: ((carId: CarId) => void) | null = null;
const picker = createCarPicker(carsEl, readSavedCarId(localStorage), (carId) => {
  saveCarId(localStorage, carId);
  announceCar?.(carId);
});

const joinedCarId = picker.selected();
const conn = await connectToArena(`ws://${location.hostname}:${SERVER_PORT}`, 'rider', joinedCarId);
announceCar = (carId) => conn.selectCar(carId);
if (picker.selected() !== joinedCarId) conn.selectCar(picker.selected());
const heightField = createHeightField(conn.seed);
const biome = createBiome(conn.seed);
const knockables = new Knockables(() => audio.knock());

const carModelEntryId = (carId: CarId): string => `car:${carId}`;

// One manifest and one progress readout for the sky, the ground and prop textures, and the car.
// Any failed file stops the game with its message in the start overlay: there is no fallback
// sky or car, so a missing file cannot hide behind a look that almost works.
const SKY_HDR_URL = '/sky/goegap_2k.hdr';
const SKY_BACKGROUND_URL = '/sky/goegap_sky_4k.webp';
const SAND_SET_ID = 'Ground054';
const manifest: AssetManifestEntry[] = [
  { id: 'sky-hdr', kind: 'hdr', url: SKY_HDR_URL },
  { id: 'sky-background', kind: 'texture', url: SKY_BACKGROUND_URL },
  ...CAR_IDS.map((carId): AssetManifestEntry => ({
    id: carModelEntryId(carId),
    kind: 'model',
    url: carDefinitionFor(carId).modelUrl,
  })),
  ...[...POLY_PROP_IDS, GRASS_MODEL_ID].map((propId): AssetManifestEntry => ({
    id: `prop:${propId}`,
    kind: 'model',
    url: polyPropUrl(propId),
  })),
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

const startGoEl = startEl.querySelector<HTMLElement>('.start-go');
const startSubEl = startEl.querySelector<HTMLElement>('.start-sub');
const startSubDefaultText = startSubEl?.textContent ?? '';
if (startSubEl) startSubEl.textContent = 'Загрузка… 0%';
let assets: LoadedAssets;
try {
  assets = await loadAssets(manifest, (fraction) => {
    if (startSubEl) startSubEl.textContent = `Загрузка… ${Math.round(fraction * 100)}%`;
  });
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  // The Forester GLB is gitignored and built locally, so on a fresh clone it is expected to be missing.
  const foresterMissing = error instanceof AssetLoadError && error.url === carDefinitionFor('forester').modelUrl;
  if (startSubEl) {
    startSubEl.textContent = foresterMissing ? FORESTER_MODEL_MISSING_MESSAGE : `Ошибка загрузки: ${reason}`;
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
registerPolyProps((propId) => loadedModel(`prop:${propId}`));
setTerrainMaterial(createTerrainMaterial(sandSet, boulderRockTexture()));

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
const solidChunks = new Map<string, ChunkCoord>();
const terrain = new TerrainManager(conn.seed, ctx.scene, biome, heightField, knockables, {
  onLoad: (key, heights, ox, oz, solidProps) => {
    colliders.set(key, addChunkCollider(world, heights, ox, oz));
    const cx = Math.round(ox / CHUNK_SIZE);
    const cz = Math.round(oz / CHUNK_SIZE);
    solidChunks.set(key, { cx, cz });
    const cols = [...addFeatureColliders(world, featuresInChunk(cx, cz), heightField), ...addSolidPropColliders(world, solidProps)];
    if (cols.length) featureColliders.set(key, cols);
  },
  onUnload: (key) => {
    solidChunks.delete(key);
    const c = colliders.get(key);
    if (c) { removeCollider(world, c); colliders.delete(key); }
    const fc = featureColliders.get(key);
    if (fc) { for (const col of fc) removeCollider(world, col); featureColliders.delete(key); }
  },
});

// Spawn the local car on the authored spawn knoll. (The server places each player on a small
// spawn spiral there too; with no reconciliation yet, the local car is what our own camera follows.)
const spawnX = SPAWN.x;
const spawnZ = SPAWN.z;
terrain.update(spawnX, spawnZ, 5); // request colliders around the spawn before the buggy drops
// Spawn above the surface so the car lands on its wheels (a too-low spawn lands on the chassis
// belly → wheels never grip). The start gate below waits for the colliders it lands on.
const spawn = { x: spawnX, y: heightField(spawnX, spawnZ) + 8, z: spawnZ };

// The car drops onto the ground within its first second, so the chunks it can reach by then must
// have colliders before it exists; otherwise it falls through and never stops.
const spawnAreaChunkKeys = chunksInRadius(worldToChunk(spawn.x, spawn.z), 1).map(chunkKey);
let readyToDrive = false;
if (startSubEl) startSubEl.textContent = 'Загрузка мира…';
function openStartGateWhenGroundIsSolid(): void {
  if (readyToDrive || !spawnAreaChunkKeys.every((key) => colliders.has(key))) return;
  readyToDrive = true;
  if (startSubEl) startSubEl.textContent = startSubDefaultText;
  if (startGoEl) startGoEl.style.display = '';
}

// Fit every car's model to its own physics chassis and register it once, before any car mesh
// (local or remote) is built.
for (const carId of CAR_IDS) {
  const car = carDefinitionFor(carId);
  const carFit = fitCarToChassis(car.measured, vehicleConfigFor(carId));
  registerCarAsset(carId, assembleCar(loadedModel(carModelEntryId(carId)), carFit, car.rules));
}

interface LocalCar {
  buggy: Buggy;
  carId: CarId;
  config: VehicleConfig;
  /** Grip under the car from the latest surface sample (the same one the tyre audio uses). */
  grip: number;
}
// Built on the start click, so the car the player picked is the one that drives.
let localCar: LocalCar | null = null;

const views = new PlayerViews(ctx.scene, world); // remote players only
const keyboard = new Keyboard();
// TEMP debug hook
window.__dbg = () => {
  if (!localCar) return null;
  const buggy = localCar.buggy;
  const p = buggy.position();
  return {
    carId: localCar.carId,
    pos: { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1) },
    speed: +buggy.speed().toFixed(2),
    ...buggy.debug(),
    keys: [...keyboard.keys],
    remoteCars: [...conn.players().keys()].filter((id) => id !== conn.sessionId).map((id) => views.carIdOf(id)),
    remotes: [...conn.players().keys()].filter((id) => id !== conn.sessionId).map((id) => {
      const group = views.group(id);
      const carId = views.carIdOf(id);
      if (!group || !carId) return null;
      const radius = vehicleConfigFor(carId).wheel.radius;
      const wheelClearance = group.children.slice(1).map((pivot) => {
        const centre = pivot.getWorldPosition(new Vector3());
        return +(centre.y - radius - terrainSurfaceHeight(heightField, centre.x, centre.z)).toFixed(2);
      });
      return { carId, pos: { x: +group.position.x.toFixed(1), y: +group.position.y.toFixed(2), z: +group.position.z.toFixed(1) }, wheelClearance };
    }),
    orbit: { ...chase.orbit },
    cameraClearance: +(ctx.camera.position.y - terrainSurfaceHeight(heightField, ctx.camera.position.x, ctx.camera.position.z)).toFixed(2),
  };
};
window.__tp = (x, z) => {
  localCar?.buggy.teleport(x, heightField(x, z) + 3, z);
  tracks.breakChains();
};
const chase = new ChaseCamera(ctx.camera, (x, z) => terrainSurfaceHeight(heightField, x, z));
chase.bindInput(canvas);
window.__orbit = chase.orbit;
// What the camera looks at while the start overlay is up and no car exists yet.
const spawnViewTarget = new Object3D();
spawnViewTarget.position.set(spawn.x, heightField(spawn.x, spawn.z), spawn.z);
const tracks = new TireTracks(ctx.scene, heightField, biome, sandSet, 4);
const grass = new Grass(ctx.scene, loadedModel(`prop:${GRASS_MODEL_ID}`), heightField, biome);
ctx.onQualityChange((tier) => {
  grass.setTier(tier);
  setHighTierPropsVisible(tier.extraProps);
});
window.addEventListener('keydown', (event) => {
  if (!event.repeat && event.code === 'KeyQ') ctx.setQuality(otherQuality(ctx.quality()));
});
const water = new Water(ctx.scene, biome.waterLevel);
const playerCountEl = document.getElementById('player-count');
const speedEl = document.getElementById('speed');
const hudErrorEl = document.getElementById('hud-error');
const showErrorsInHud = debugModeEnabled();

const addRemote = (id: string, player: NetPlayer) => {
  if (id !== conn.sessionId) views.add(id, sanitizeCarId(player.carId));
};
for (const [id, player] of conn.players()) addRemote(id, player);
conn.onAdd(addRemote);
conn.onRemove((id) => views.remove(id));

function startDriving(carId: CarId): void {
  const config = vehicleConfigFor(carId);
  const surface = surfaceSampleAt(heightField, spawn.x, spawn.z);
  const grip = terrainGripFor(biome.coverAt(spawn.x, spawn.z, surface.height, surface.slope), config);
  localCar = { buggy: new Buggy(world, ctx.scene, spawn, carId), carId, config, grip };
}

startEl.addEventListener('click', () => {
  if (!readyToDrive) return; // ignore clicks while the assets or the ground under the spawn still load
  if (!localCar) startDriving(picker.selected());
  startEl.style.display = 'none';
  window.focus();
  audio.resume(); // user gesture → unlock audio
  audio.ui();
});

// R flips the car back upright (recover from a roll), here and in the server's copy.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyR' || !localCar) return;
  localCar.buggy.reset();
  tracks.breakChains();
  conn.sendResetCar();
});

// Below the drawn ground by this much, the car can only have fallen through a missing collider.
const FALL_THROUGH_MARGIN = 10;
// Keeps a recovered car off the very edge of the chunk it lands on.
const CHUNK_EDGE_INSET = 4;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function nearestSolidGround(x: number, z: number): { x: number; y: number; z: number } {
  let best: { x: number; z: number } | null = null;
  let bestDistance = Infinity;
  for (const coord of solidChunks.values()) {
    const origin = chunkOrigin(coord);
    const candidateX = clamp(x, origin.x + CHUNK_EDGE_INSET, origin.x + CHUNK_SIZE - CHUNK_EDGE_INSET);
    const candidateZ = clamp(z, origin.z + CHUNK_EDGE_INSET, origin.z + CHUNK_SIZE - CHUNK_EDGE_INSET);
    const distance = Math.hypot(candidateX - x, candidateZ - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: candidateX, z: candidateZ };
    }
  }
  if (!best) throw new Error('fall guard: no terrain collider is loaded, so there is no ground to put the car on');
  return { x: best.x, y: terrainSurfaceHeight(heightField, best.x, best.z) + RESET_LIFT, z: best.z };
}

/** A car under the ground is a bug, not a state to live with: say so loudly and put it back. */
function recoverIfFallenThrough(buggy: Buggy): void {
  const position = buggy.position();
  const ground = terrainSurfaceHeight(heightField, position.x, position.z);
  if (position.y >= ground - FALL_THROUGH_MARGIN) return;
  const landing = nearestSolidGround(position.x, position.z);
  console.error(
    `[fall guard] the car fell through the ground at x=${position.x.toFixed(1)} y=${position.y.toFixed(1)} `
    + `z=${position.z.toFixed(1)} (ground ${ground.toFixed(1)}, chunk ${chunkKey(worldToChunk(position.x, position.z))} `
    + `solid: ${colliders.has(chunkKey(worldToChunk(position.x, position.z)))}); placed upright at `
    + `x=${landing.x.toFixed(1)} y=${landing.y.toFixed(1)} z=${landing.z.toFixed(1)}`,
  );
  buggy.placeUprightAt(landing.x, landing.y, landing.z);
  tracks.breakChains();
}

const guard = createFrameGuard((subsystem, message) => {
  console.error(`[frame] ${subsystem} failed: ${message}`);
  if (showErrorsInHud && hudErrorEl) {
    hudErrorEl.textContent = `${subsystem}: ${message}`;
    hudErrorEl.hidden = false;
  }
});

const STEP = world.timestep;
let last = performance.now() / 1000;
let acc = 0;

function frame() {
  // Scheduled first, so nothing below can stop the next frame.
  requestAnimationFrame(frame);
  const nowS = performance.now() / 1000;
  const dt = Math.min(nowS - last, 0.1); // clamp after a tab pause
  last = nowS;
  const now = performance.now();

  const car = localCar;
  if (car) {
    const buggy = car.buggy;
    acc += dt;
    const controls = controlsFromKeys(keyboard.keys);
    guard.run('network input', () => conn.sendInput(sanitizeInput(controls))); // server (for other players)
    guard.run('brake lights', () => setBrakeLights(getCarMaterials(buggy.mesh), controls.brake > 0.1)); // this car's own tail lights only

    guard.run('physics', () => {
      while (acc >= STEP) {
        acc -= STEP;
        buggy.applyControls(controls, car.grip);
        world.step();
        buggy.update();
      }
    });
    guard.run('fall guard', () => recoverIfFallenThrough(buggy));

    const p = buggy.position();
    guard.run('terrain', () => terrain.update(p.x, p.z, 5));
    guard.run('tyre tracks', () => {
      const forward = new Vector3(0, 0, 1).applyQuaternion(buggy.mesh.quaternion);
      tracks.update(buggy.wheelContacts(), p.x, p.z, Math.atan2(forward.x, forward.z), buggy.tyreWidth());
    });
    guard.run('water', () => water.update(p.x, p.z));
    guard.run('sun', () => ctx.focusSun(p.x, p.y, p.z));
    guard.run('camera', () => chase.update(buggy.mesh, dt));

    // knock over trees/cacti the car ploughs through (fall toward travel direction)
    guard.run('knockables', () => {
      const cq = buggy.mesh.quaternion;
      const fwdX = 2 * (cq.x * cq.z + cq.w * cq.y);
      const fwdZ = 1 - 2 * (cq.x * cq.x + cq.y * cq.y);
      knockables.update(p.x, p.z, fwdX, fwdZ, buggy.speed(), dt);
    });

    // tyre sound and grip matched to the surface under the car
    guard.run('audio', () => {
      const surface = surfaceSampleAt(heightField, p.x, p.z);
      const cover = biome.coverAt(p.x, p.z, surface.height, surface.slope);
      car.grip = terrainGripFor(cover, car.config);
      audio.updateLocal({
        carId: car.carId,
        spec: car.config.drivetrain,
        drivetrain: buggy.drivetrain(),
        throttle: controls.throttle,
        brake: controls.brake,
        forwardSpeed: buggy.forwardSpeed(),
        speed: buggy.speed(),
        wheelsInContact: buggy.wheelsInContact(),
        wheelCount: buggy.wheelCount(),
        cover,
        rotation: buggy.mesh.quaternion,
        groundClearance: p.y - terrainSurfaceHeight(heightField, p.x, p.z),
        dt,
      });
    });
    guard.run('hud', () => {
      if (speedEl) speedEl.textContent = String(Math.round(buggy.speed() * 3.6));
    });
  } else {
    guard.run('start gate', openStartGateWhenGroundIsSolid);
    // The world is not stepped until a car exists, so the remote wheels' ground rays need this.
    guard.run('scene queries', () => world.updateSceneQueries());
    guard.run('sun', () => ctx.focusSun(spawn.x, spawn.y, spawn.z));
    guard.run('camera', () => chase.update(spawnViewTarget, dt));
  }

  // Remote players from the server, interpolated a little in the past.
  guard.run('remote players', () => {
    const renderTime = now - 1000 / 10;
    for (const [id, p] of conn.players()) {
      if (id !== conn.sessionId) views.pushState(id, p, now);
    }
    views.update(renderTime, null, renderTime);
  });
  guard.run('remote engine sound', () => {
    audio.setListener(ctx.camera);
    const remoteCars: RemoteCarPose[] = [];
    for (const id of conn.players().keys()) {
      const group = views.group(id);
      const carId = views.carIdOf(id);
      if (id !== conn.sessionId && group && carId) remoteCars.push({ id, carId, position: group.position, rotation: group.quaternion });
    }
    audio.updateRemotes(remoteCars, dt);
  });
  guard.run('hud', () => {
    if (playerCountEl) playerCountEl.textContent = String(conn.players().size);
  });

  guard.run('grass', () => grass.update(ctx.camera.position));
  guard.run('prop draw distance', () => updatePropVisibility(ctx.camera.position.x, ctx.camera.position.z));
  guard.run('render', () => ctx.render());
}
requestAnimationFrame(frame);
