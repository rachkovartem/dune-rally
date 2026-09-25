// src/main.ts
import { createRenderer } from './render/renderer';
import { loadAssets } from './assets/loadAssets';
import { createHeightField } from './world/noise';
import { createBiome } from './world/biome';
import { groundAt } from './world/groundAt';
import { CHUNK_SIZE, chunkKey, chunkOrigin, chunksInRadius, worldToChunk, type ChunkCoord } from './world/chunk';
import { featuresInChunk, spawnPoseFor, SPAWN_LIFT, type SpawnPose } from './world/worldDef';
import { borderEscapeTarget } from './world/borderSafety';
import { TerrainManager } from './world/terrainManager';
import { initPhysics, addChunkCollider, addFeatureColliders, addSolidPropColliders, removeCollider } from './physics/physicsWorld';
import { Buggy } from './vehicle/buggy';
import { vehicleConfigFor, type VehicleConfig } from './vehicle/vehicleConfig';
import { CAR_IDS, DEFAULT_CAR_ID, type CarId } from './vehicle/cars';
import { terrainSurfaceHeight } from './world/chunkGeometry';
import { Keyboard } from './input/keyboard';
import { controlsFromKeys } from './input/controls';
import { CameraRig, cameraModeLabelFor, readSavedCameraMode, saveCameraMode } from './render/cameraModes';
import { connectToArena, type NetPlayer } from './net/connection';
import { PlayerViews } from './net/playerViews';
import { TireTracks } from './render/groundDecals';
import { Knockables } from './render/knockables';
import { AudioManager, type RemoteCarPose } from './audio/audio';
import { POSE_HZ, sanitizeCarId, sanitizeInput, type PoseMsg } from '../shared/protocol';
import type { GroundGrip } from '../shared/terrainGrip';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RESET_LIFT } from '../shared/vehiclePhysics';
import { carDefinitionFor } from './assets/carCatalog';
import { assembleCar, fitCarToChassis } from './render/carModel';
import { registerCarAsset, getCarMaterials } from './render/buggyMesh';
import { setBrakeLights } from './render/carMaterials';
import { AssetLoadError, type AssetManifestEntry, type LoadedAssets } from './assets/loadAssets';
import { ASSET_MANIFEST_FILE, assetRootFor, createAssetResolver, loadAssetManifest, type AssetResolver } from './assets/assetUrls';
import { gameServerUrl } from './net/serverUrl';
import { SERVER_RETRY_DELAYS_MS, waitForServer } from './net/waitForServer';
import { PROP_TEXTURE_SETS, type PropKind } from './assets/textureManifest';
import { createTerrainMaterial } from './render/terrainMaterial';
import { setTerrainMaterial } from './render/terrainMesh';
import { createPropMaterials } from './render/propMaterials';
import { setHighTierPropsVisible, setPropMaterials, updatePropVisibility } from './render/scatter';
import { boulderRockTexture, GRASS_MODEL_ID, POLY_PROP_IDS, polyPropUrl, registerPolyProps } from './render/polyProps';
import { FarTerrain, meanTextureColor, type LinearColor } from './render/farTerrain';
import { Grass } from './render/grass';
import { otherQuality } from './render/qualityTiers';
import { SRGBColorSpace, RepeatWrapping, Object3D, Vector3, type DataTexture, type Group, type Texture } from 'three';
import { readSavedCarId, saveCarId } from './ui/carChoice';
import { createCarPicker } from './ui/carPicker';
import { createFrameGuard } from './debug/frameGuard';
import { debugModeEnabled } from './render/devOverlay';
import { formatDebugReadout } from './ui/debugReadout';
import { createCompass } from './ui/compass';
import { createCameraModeBanner } from './ui/cameraModeBanner';
import type { Cover } from './world/biome';

const canvas = document.getElementById('app');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Expected a <canvas id="app"> element in the page.');
}
const startEl = document.getElementById('start');
const carsEl = startEl?.querySelector<HTMLElement>('.start-cars');
if (!startEl || !carsEl) throw new Error('Expected the #start overlay with a .start-cars picker in the page.');
const startGoEl = startEl.querySelector<HTMLElement>('.start-go');
const startSubEl = startEl.querySelector<HTMLElement>('.start-sub');
const startSubDefaultText = startSubEl?.textContent ?? '';
const showStartError = (message: string): void => {
  if (!startSubEl) return;
  startSubEl.textContent = message;
  startSubEl.style.color = '#ff6b5a';
};

// In dev the files come from public/; a production build reads the CDN manifest first, because
// every asset URL (sounds included) is a hashed name listed there.
const assetBaseUrl = import.meta.env.VITE_ASSET_BASE_URL;
let resolveAsset: AssetResolver;
if (assetBaseUrl === undefined || assetBaseUrl === '') {
  resolveAsset = createAssetResolver({ baseUrl: null, files: {} });
} else {
  const assetRoot = assetRootFor(assetBaseUrl);
  try {
    const assetManifest = await loadAssetManifest({
      url: `${assetRoot}/${ASSET_MANIFEST_FILE}`,
      fetchJson: (url) => fetch(url, { cache: 'no-cache' }),
    });
    resolveAsset = createAssetResolver({ baseUrl: assetRoot, files: assetManifest.files });
  } catch (error) {
    showStartError(`Ошибка загрузки: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

const audio = new AudioManager(resolveAsset);
window.__audio = () => audio.snapshot();
// Wired before connecting, so a choice made on the loading screen is not lost. The server hears
// every change at once, and other players see the right model before this player starts driving.
let announceCar: ((carId: CarId) => void) | null = null;
const picker = createCarPicker(carsEl, readSavedCarId(localStorage), (carId) => {
  saveCarId(localStorage, carId);
  announceCar?.(carId);
});

const joinedCarId = picker.selected();
const serverUrl = gameServerUrl(location, { dev: import.meta.env.DEV, override: import.meta.env.VITE_GAME_SERVER_URL });
const conn = await connectToArena(serverUrl, 'rider', joinedCarId);
// A restart or deploy closes the room. The page waits for the server and reloads: the world comes
// back from the same seed and the assets from the browser cache.
const serverRestartEl = document.getElementById('server-restart');
if (!serverRestartEl) throw new Error('Expected a #server-restart overlay in the page.');
let serverDropped = false;
conn.onDropped(() => {
  if (serverDropped) return;
  serverDropped = true;
  serverRestartEl.hidden = false;
  const probe = async (): Promise<boolean> => {
    const response = await fetch('/health', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return response.ok;
  };
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  void waitForServer({ probe, sleep, delaysMs: SERVER_RETRY_DELAYS_MS }).then(() => location.reload());
});
announceCar = (carId) => conn.selectCar(carId);
if (picker.selected() !== joinedCarId) conn.selectCar(picker.selected());
const heightField = createHeightField(conn.seed);
const biome = createBiome(conn.seed);
const knockables = new Knockables(() => audio.knock());

const carModelEntryId = (carId: CarId): string => `car:${carId}`;
const carModelEntry = (carId: CarId): AssetManifestEntry => ({ id: carModelEntryId(carId), kind: 'model', url: carDefinitionFor(carId).modelUrl });
// A car whose local model is not required loads on its own, so its missing file cannot stop the game.
const optionalCars = CAR_IDS.flatMap((carId) => {
  const localModel = carDefinitionFor(carId).localModel;
  return localModel !== null && !localModel.requiredToPlay ? [{ carId, missingMessage: localModel.missingMessage }] : [];
});
const isOptionalCar = (carId: CarId): boolean => optionalCars.some((optionalCar) => optionalCar.carId === carId);

// One manifest and one progress readout for the sky, the ground and prop textures, and the cars.
// Any failed file stops the game with its message in the start overlay: there is no fallback
// sky or car, so a missing file cannot hide behind a look that almost works. The one exception is
// an optional car: it leaves the picker, and its message stays on the start screen.
const SKY_HDR_URL = '/sky/goegap_2k.hdr';
const SKY_BACKGROUND_URL = '/sky/goegap_sky_4k.webp';
const SAND_SET_ID = 'Ground054';
const manifest: AssetManifestEntry[] = [
  { id: 'sky-hdr', kind: 'hdr', url: SKY_HDR_URL },
  { id: 'sky-background', kind: 'texture', url: SKY_BACKGROUND_URL },
  ...CAR_IDS.filter((carId) => !isOptionalCar(carId)).map(carModelEntry),
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

if (startSubEl) startSubEl.textContent = 'Загрузка… 0%';
const carsNoteEl = carsEl.querySelector<HTMLElement>('.start-cars-note');
if (!carsNoteEl) throw new Error('Expected a .start-cars-note element in the car picker.');
const missingCarMessages: string[] = [];
/** Loads one optional car's model; a failed file withdraws only that car, with its message on screen. */
const loadOptionalCar = async (carId: CarId, missingMessage: string): Promise<{ carId: CarId; model: Group } | null> => {
  const entry = carModelEntry(carId);
  try {
    const loaded = await loadAssets([entry], undefined, resolveAsset);
    const model = loaded.models.get(entry.id);
    if (!model) throw new Error(`Expected the "${entry.id}" model to be present in the loaded assets.`);
    return { carId, model };
  } catch (error) {
    if (!(error instanceof AssetLoadError) || error.url !== entry.url) throw error;
    console.warn(`[car model] ${missingMessage} (${error.message}); the car is removed from the picker`);
    missingCarMessages.push(missingMessage);
    carsNoteEl.textContent = missingCarMessages.join(' · ');
    carsNoteEl.hidden = false;
    picker.withdraw(carId, DEFAULT_CAR_ID);
    return null;
  }
};
const optionalCarsLoading = Promise.all(optionalCars.map(({ carId, missingMessage }) => loadOptionalCar(carId, missingMessage)));
let assets: LoadedAssets;
try {
  assets = await loadAssets(manifest, (fraction) => {
    if (startSubEl) startSubEl.textContent = `Загрузка… ${Math.round(fraction * 100)}%`;
  }, resolveAsset);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  // A gitignored model is expected to be missing on a fresh clone; its own message says how to build it.
  const missingCar = CAR_IDS.find((carId) => error instanceof AssetLoadError && error.url === carDefinitionFor(carId).modelUrl);
  const missingMessage = missingCar === undefined ? null : carDefinitionFor(missingCar).localModel?.missingMessage ?? null;
  if (startSubEl) {
    startSubEl.textContent = missingMessage ?? `Ошибка загрузки: ${reason}`;
    startSubEl.style.color = '#ff6b5a';
  }
  throw error;
}
for (const optionalCar of await optionalCarsLoading) {
  if (optionalCar) assets.models.set(carModelEntryId(optionalCar.carId), optionalCar.model);
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
const rockTexture = boulderRockTexture();
setTerrainMaterial(createTerrainMaterial(sandSet, rockTexture));

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

// The local player's buggy is simulated LOCALLY at 60fps for smooth, instant control. Inputs go to
// the server, and so does the car's pose a few times a second, so the server can pull its copy (the
// car other players see) back to where the driver really is.
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

// The far layer: the whole map on a coarse grid, so the landforms and the ranges stand on the
// horizon past the streamed chunks. It is built once, and the start gate waits for it.
const FAR_GRID_STEP = 8;
const FAR_GRID_MARGIN = 128;
// The near sand's normal and occlusion maps darken it a little against a flat colour; measured
// at the near/far seam from the spawn, the plain mean was 4 % too bright.
const FAR_SAND_SHADING = 0.96;
const sandImageMean = meanTextureColor(sandSet.color);
const sandMean: LinearColor = { r: sandImageMean.r * FAR_SAND_SHADING, g: sandImageMean.g * FAR_SAND_SHADING, b: sandImageMean.b * FAR_SAND_SHADING };
// The near rock layer is the rock image times (0.55 + 0.9 × a second sample of it); this is its mean.
const rockImageMean = meanTextureColor(rockTexture);
const rockLayerMean = (channel: number): number => channel * (0.55 + 0.9 * channel);
const rockMean: LinearColor = { r: rockLayerMean(rockImageMean.r), g: rockLayerMean(rockImageMean.g), b: rockLayerMean(rockImageMean.b) };
let farTerrain: FarTerrain | null = null;
window.__farTerrain = null;
const farGridRequestedAt = performance.now();
terrain.requestFarGrid(FAR_GRID_STEP, FAR_GRID_MARGIN).then((grid) => {
  const gridMs = performance.now() - farGridRequestedAt;
  const meshStartedAt = performance.now();
  const far = new FarTerrain(grid, { sandMean, rockMean });
  ctx.scene.add(far.mesh);
  terrain.onDrawnChange((chunk, drawn) => far.setNearChunkDrawn(chunk, drawn));
  farTerrain = far;
  window.__farTerrain = { gridMs, meshMs: performance.now() - meshStartedAt };
}, (error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  if (startSubEl) {
    startSubEl.textContent = `Ошибка загрузки мира: ${reason}`;
    startSubEl.style.color = '#ff6b5a';
  }
  console.error('[far terrain]', error);
});

// Each player starts in the spawn slot the server gave them, so the local car and the server's
// copy of it start at the same spot, facing north.
function ownSpawnSlot(): number | null {
  const slot = conn.players().get(conn.sessionId)?.spawnSlot;
  return slot !== undefined && slot >= 0 ? slot : null;
}
// Until the own slot arrives, the start screen looks north from the front of the grid.
const PREVIEW_SLOT = 0;
function currentSpawnPose(): SpawnPose & { y: number } {
  const pose = spawnPoseFor(ownSpawnSlot() ?? PREVIEW_SLOT);
  return { ...pose, y: terrainSurfaceHeight(heightField, pose.x, pose.z) + SPAWN_LIFT };
}
let spawn = currentSpawnPose();
terrain.update(spawn.x, spawn.z, 0, 0); // request colliders around the spawn before the buggy drops

let readyToDrive = false;
if (startSubEl) startSubEl.textContent = 'Загрузка мира…';
// The car drops onto the ground within its first second, so the chunks it can reach by then must
// have colliders before it exists; otherwise it falls through and never stops.
function openStartGateWhenReady(): void {
  if (readyToDrive || farTerrain === null || ownSpawnSlot() === null) return;
  const spawnAreaChunkKeys = chunksInRadius(worldToChunk(spawn.x, spawn.z), 1).map(chunkKey);
  if (!spawnAreaChunkKeys.every((key) => colliders.has(key))) return;
  readyToDrive = true;
  if (startSubEl) startSubEl.textContent = startSubDefaultText;
  if (startGoEl) startGoEl.style.display = '';
}

// Fit every car's model to its own physics chassis and register it once, before any car mesh
// (local or remote) is built.
const drawableCars = new Set<CarId>();
for (const carId of CAR_IDS) {
  const model = assets.models.get(carModelEntryId(carId));
  // Only an optional car can be absent here: a required model that failed has already stopped the game.
  if (!model) continue;
  const car = carDefinitionFor(carId);
  const carFit = fitCarToChassis(car.measured, vehicleConfigFor(carId));
  registerCarAsset(carId, assembleCar(model, carFit, car.rules));
  drawableCars.add(carId);
}
const reportedStandIns = new Set<CarId>();
/** Another player's car whose model this machine does not have is drawn as the default car, and said so once. */
function drawnCarFor(carId: CarId): CarId {
  if (drawableCars.has(carId)) return carId;
  if (!reportedStandIns.has(carId)) {
    reportedStandIns.add(carId);
    console.warn(`[car model] no "${carId}" model here; other players' ${carId} cars are drawn as the ${DEFAULT_CAR_ID}`);
  }
  return DEFAULT_CAR_ID;
}

interface LocalCar {
  buggy: Buggy;
  carId: CarId;
  config: VehicleConfig;
  /** Ground under the car from the latest surface sample (the same one the tyre audio uses). */
  ground: GroundGrip;
  /** Surface cover under the car from that same sample. */
  cover: Cover;
}
// Built on the start click, so the car the player picked is the one that drives.
let localCar: LocalCar | null = null;

// Remote players only. Past the collider ring there is no collider under a remote car, so its
// wheels stand on the drawn ground instead.
const views = new PlayerViews(ctx.scene, world, (x, z) => terrainSurfaceHeight(heightField, x, z), drawnCarFor);
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
    cameraMode: cameraRig.mode(),
    orbit: { ...cameraRig.chase.orbit },
    cameraClearance: +(ctx.camera.position.y - terrainSurfaceHeight(heightField, ctx.camera.position.x, ctx.camera.position.z)).toFixed(2),
  };
};
window.__terrain = () => terrain.stats();
window.__tp = (x, z) => {
  localCar?.buggy.teleport(x, heightField(x, z) + 3, z);
  tracks.breakChains();
};
const cameraBannerEl = document.getElementById('hud-camera');
if (!cameraBannerEl) throw new Error('Expected a #hud-camera element in the HUD.');
const cameraBanner = createCameraModeBanner(cameraBannerEl);
const cameraRig = new CameraRig(ctx.camera, (x, z) => terrainSurfaceHeight(heightField, x, z), readSavedCameraMode(localStorage), (mode) => {
  saveCameraMode(localStorage, mode);
  cameraBanner.show(cameraModeLabelFor(mode, localCar === null || carDefinitionFor(localCar.carId).hasCabin));
});
cameraRig.bindInput(canvas);
window.__orbit = cameraRig.chase.orbit;
// What the camera looks at while the start overlay is up and no car exists yet.
const spawnViewTarget = new Object3D();
function aimSpawnView(): void {
  spawnViewTarget.position.set(spawn.x, spawn.y - SPAWN_LIFT, spawn.z);
  spawnViewTarget.rotation.y = spawn.yaw;
}
aimSpawnView();
const tracks = new TireTracks(ctx.scene, heightField, biome, sandSet, 4);
const grass = new Grass(ctx.scene, loadedModel(`prop:${GRASS_MODEL_ID}`), heightField, biome);
ctx.onQualityChange((tier) => {
  grass.setTier(tier);
  setHighTierPropsVisible(tier.extraProps);
});
window.addEventListener('keydown', (event) => {
  if (!event.repeat && event.code === 'KeyQ') ctx.setQuality(otherQuality(ctx.quality()));
});
const playerCountEl = document.getElementById('player-count');
const speedEl = document.getElementById('speed');
const hudErrorEl = document.getElementById('hud-error');
const compassEl = document.getElementById('hud-compass');
if (!compassEl) throw new Error('Expected a #hud-compass element in the HUD.');
const compass = createCompass(compassEl);
const cameraForward = new Vector3();
const showErrorsInHud = debugModeEnabled();
const showDebugReadout = debugModeEnabled();
// The readout is text for a person; ten updates a second are enough and keep layout work low.
const READOUT_INTERVAL_MS = 100;
let lastReadoutAt = -Infinity;
let lastPoseSentAt = -Infinity;

function poseOf(buggy: Buggy): PoseMsg {
  const position = buggy.position();
  const rotation = buggy.mesh.quaternion;
  const velocity = buggy.velocity();
  return {
    x: position.x, y: position.y, z: position.z,
    qx: rotation.x, qy: rotation.y, qz: rotation.z, qw: rotation.w,
    vx: velocity.x, vy: velocity.y, vz: velocity.z,
  };
}

const addRemote = (id: string, player: NetPlayer) => {
  if (id !== conn.sessionId) views.add(id, sanitizeCarId(player.carId));
};
for (const [id, player] of conn.players()) addRemote(id, player);
conn.onAdd(addRemote);
conn.onRemove((id) => views.remove(id));

function startDriving(carId: CarId): void {
  const config = vehicleConfigFor(carId);
  spawn = currentSpawnPose();
  const { cover, ground } = groundAt(biome, heightField, spawn.x, spawn.z, config);
  localCar = { buggy: new Buggy(world, ctx.scene, spawn, carId), carId, config, ground, cover };
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

/** The same border net the server runs on its copy: a car over a crest or out of the map goes back to the valley. */
function catchEscapeOverBorder(buggy: Buggy): void {
  const position = buggy.position();
  const target = borderEscapeTarget(position.x, position.y, position.z, heightField);
  if (target === null) return;
  const landing = { ...target, y: terrainSurfaceHeight(heightField, target.x, target.z) + SPAWN_LIFT };
  console.info(
    `[border safety] the car got over the border at x=${position.x.toFixed(1)} y=${position.y.toFixed(1)} `
    + `z=${position.z.toFixed(1)}; placed at x=${landing.x.toFixed(1)} z=${landing.z.toFixed(1)}`,
  );
  buggy.placeAt(landing);
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
        buggy.applyControls(controls, car.ground);
        world.step();
        buggy.update();
      }
    });
    guard.run('fall guard', () => recoverIfFallenThrough(buggy));
    guard.run('border safety', () => catchEscapeOverBorder(buggy));
    if (now - lastPoseSentAt >= 1000 / POSE_HZ) {
      lastPoseSentAt = now;
      guard.run('network pose', () => conn.sendPose(poseOf(buggy)));
    }

    const p = buggy.position();
    guard.run('terrain', () => {
      // The body's own velocity: above 60 fps some frames run no physics step, and a position
      // difference would make the look-ahead ring jump between the car and far ahead.
      const velocity = buggy.velocity();
      terrain.update(p.x, p.z, velocity.x, velocity.z);
    });
    guard.run('tyre tracks', () => {
      const forward = new Vector3(0, 0, 1).applyQuaternion(buggy.mesh.quaternion);
      tracks.update(buggy.wheelContacts(), p.x, p.z, Math.atan2(forward.x, forward.z), buggy.tyreWidth());
    });
    guard.run('sun', () => ctx.focusSun(p.x, p.y, p.z));
    guard.run('camera', () => cameraRig.update(buggy.mesh, dt, car.carId));

    // knock over trees/cacti the car ploughs through (fall toward travel direction)
    guard.run('knockables', () => {
      const cq = buggy.mesh.quaternion;
      const fwdX = 2 * (cq.x * cq.z + cq.w * cq.y);
      const fwdZ = 1 - 2 * (cq.x * cq.x + cq.y * cq.y);
      knockables.update(p.x, p.z, fwdX, fwdZ, buggy.speed(), dt);
    });

    // tyre sound and grip matched to the surface under the car
    guard.run('audio', () => {
      const { cover, ground } = groundAt(biome, heightField, p.x, p.z, car.config);
      car.cover = cover;
      car.ground = ground;
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
    if (showDebugReadout && now - lastReadoutAt >= READOUT_INTERVAL_MS) {
      lastReadoutAt = now;
      guard.run('debug readout', () => {
        const cq = buggy.mesh.quaternion;
        const forwardX = 2 * (cq.x * cq.z + cq.w * cq.y);
        const forwardZ = 1 - 2 * (cq.x * cq.x + cq.y * cq.y);
        const headingDegrees = ((Math.atan2(forwardX, -forwardZ) * 180) / Math.PI + 360) % 360;
        const streaming = terrain.stats();
        ctx.showDebugLines([
          ...formatDebugReadout({
            x: p.x, y: p.y, z: p.z, headingDegrees, cover: car.cover, grip: car.ground.grip,
            chunk: worldToChunk(p.x, p.z), serverChunks: null,
          }),
          `terrain drawn ${streaming.drawnChunks}  colliders ${streaming.colliderChunks}  `
            + `build p95 ${streaming.meshBuildMs.p95.toFixed(1)} ms  max ${streaming.meshBuildMs.max.toFixed(1)} ms`,
        ]);
      });
    }
  } else {
    guard.run('spawn view', () => {
      spawn = currentSpawnPose();
      aimSpawnView();
    });
    guard.run('terrain', () => terrain.update(spawn.x, spawn.z, 0, 0));
    guard.run('start gate', openStartGateWhenReady);
    // The world is not stepped until a car exists, so the remote wheels' ground rays need this.
    guard.run('scene queries', () => world.updateSceneQueries());
    guard.run('sun', () => ctx.focusSun(spawn.x, spawn.y, spawn.z));
    guard.run('camera', () => cameraRig.update(spawnViewTarget, dt, null));
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

  guard.run('compass', () => {
    ctx.camera.getWorldDirection(cameraForward);
    compass.update(cameraForward.x, cameraForward.z);
  });
  guard.run('grass', () => grass.update(ctx.camera.position));
  guard.run('prop draw distance', () => updatePropVisibility(ctx.camera.position.x, ctx.camera.position.z));
  guard.run('render', () => ctx.render());
}
requestAnimationFrame(frame);
