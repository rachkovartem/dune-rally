// src/audio/audio.ts
import { Quaternion as ThreeQuaternion, Vector3, type Camera } from 'three';
import type { CarId } from '../vehicle/cars';
import { readSavedCarId } from '../ui/carChoice';
import { EngineAudio, EngineInputError, assertFiniteFrame, type LocalEngineFrame, type LocalEngineSnapshot } from './engineAudio';
import { RemoteEngines, type RemoteCarPose, type RemoteEngineSnapshot } from './remoteEngines';
import {
  defaultCarChoice, parseSoundSettings, recordedRpmOf, serializeSoundSettings, SOUND_SETTINGS_STORAGE_KEY, type SoundSettings,
} from './soundChoice';
import {
  LAYER_NAMES, parseSoundManifest, SOUND_BASE_URL, SOUND_MANIFEST_URL, soundEntryFor, type LayerName, type SoundEntry, type SoundManifest,
} from './soundManifest';
import { createSoundPicker, type SoundPicker } from './soundPicker';

export type { LocalEngineFrame } from './engineAudio';
export type { RemoteCarPose } from './remoteEngines';

/** Names the sound file that failed, so the console says which one and why. */
export class SoundLoadError extends Error {
  constructor(readonly url: string, reason: string) {
    super(`${url} (${reason})`);
    this.name = 'SoundLoadError';
  }
}

interface LoadedSound {
  manifest: SoundManifest;
  settings: SoundSettings;
}

interface Preview {
  entryId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export interface AudioSnapshot {
  state: AudioContextState;
  started: boolean;
  loaded: boolean;
  errors: string[];
  volume: number;
  local: LocalEngineSnapshot | null;
  remotes: RemoteEngineSnapshot[];
  pickerOpen: boolean;
  pickerCar: CarId | null;
  previewing: string | null;
}

/**
 * The game's sound. Engines are recorded loops (see public/sound/ATTRIBUTION.md) driven by each
 * car's own drivetrain rpm; tyres, wind, scrape, knock and UI blips are synthesised. The context
 * starts suspended and is resumed on the start click (autoplay policy).
 */
export class AudioManager {
  private readonly context = new AudioContext({ latencyHint: 'interactive' });
  private readonly master: GainNode;
  private readonly noise: AudioBuffer;
  private readonly loops = new Map<string, Promise<AudioBuffer>>();
  private readonly errors: string[] = [];
  private started = false;
  private sound: LoadedSound | null = null;
  private local: EngineAudio | null = null;
  private remotes: RemoteEngines | null = null;
  private picker: SoundPicker | null = null;
  private preview: Preview | null = null;
  private readonly listenerPosition = new Vector3();
  private readonly listenerForward = new Vector3();
  private readonly listenerUp = new Vector3();
  private readonly listenerRotation = new ThreeQuaternion();
  /** Settles once the manifest and the chosen loops are in; a failure is already reported. */
  readonly ready: Promise<void>;

  /** `resolveUrl` maps a logical path under public/ to the URL to fetch (the CDN in production). */
  constructor(private readonly resolveUrl: (path: string) => string) {
    this.master = this.context.createGain();
    this.master.gain.value = 0.7;
    // Many loops and noise layers sum up; the limiter keeps a full-throttle crash from clipping.
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    this.master.connect(limiter).connect(this.context.destination);
    this.noise = this.makeNoise(2.3);
    this.ready = this.loadSound().catch((error: unknown) => {
      this.reportError(`engine sound is off: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private reportError(message: string): void {
    this.errors.push(message);
    console.error(`[sound] ${message}`);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index++) data[index] = Math.random() * 2 - 1;
    return buffer;
  }

  private noiseSource(loop: boolean): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.loop = loop;
    return source;
  }

  // Loaded apart from the asset loader, from page load on: a suspended context still decodes, so
  // the chosen loops are ready by the start click without holding up the world.
  private async loadSound(): Promise<void> {
    const response = await fetch(this.resolveUrl(SOUND_MANIFEST_URL));
    if (!response.ok) throw new SoundLoadError(SOUND_MANIFEST_URL, `HTTP ${response.status}`);
    const manifest = parseSoundManifest(await response.json());
    const parsed = parseSoundSettings(localStorage.getItem(SOUND_SETTINGS_STORAGE_KEY), manifest);
    for (const warning of parsed.warnings) console.warn(`[sound] ${warning}`);
    this.sound = { manifest, settings: parsed.settings };
    this.master.gain.value = parsed.settings.volume;
    this.picker = createSoundPicker({
      manifest,
      settings: parsed.settings,
      currentCar: () => this.local?.carId ?? readSavedCarId(localStorage),
      save: () => localStorage.setItem(SOUND_SETTINGS_STORAGE_KEY, serializeSoundSettings(parsed.settings)),
      layerChanged: (carId, name) => this.applyLayer(carId, name),
      resetToDefaults: (carId) => {
        parsed.settings.choices[carId] = defaultCarChoice(carId);
        localStorage.setItem(SOUND_SETTINGS_STORAGE_KEY, serializeSoundSettings(parsed.settings));
        for (const name of LAYER_NAMES) this.applyLayer(carId, name);
      },
      setVolume: (volume) => this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.02),
      togglePreview: (entry) => this.togglePreview(entry),
      stopPreview: () => this.stopPreview(),
    });
    const chosen = Object.values(parsed.settings.choices).flatMap((choice) => LAYER_NAMES.map((name) => soundEntryFor(manifest, choice.layers[name])));
    // loadLoop has already reported any failure; here only the wait matters.
    await Promise.allSettled(chosen.map((entry) => this.loadLoop(entry)));
  }

  private loadLoop = (entry: SoundEntry): Promise<AudioBuffer> => {
    const cached = this.loops.get(entry.id);
    if (cached) return cached;
    const url = SOUND_BASE_URL + entry.file;
    // Resolved inside the chain, so a file missing from the asset manifest is reported like a failed download.
    const loading = Promise.resolve()
      .then(() => fetch(this.resolveUrl(url)))
      .then((response) => {
        if (!response.ok) throw new SoundLoadError(url, `HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => this.context.decodeAudioData(data))
      .catch((error: unknown) => {
        const failure = error instanceof SoundLoadError ? error : new SoundLoadError(url, error instanceof Error ? error.message : String(error));
        this.reportError(failure.message);
        throw failure;
      });
    this.loops.set(entry.id, loading);
    return loading;
  };

  private layerEntry(carId: CarId, name: LayerName): SoundEntry {
    const sound = this.requireSound();
    return soundEntryFor(sound.manifest, sound.settings.choices[carId].layers[name]);
  }

  private recordedRpm(carId: CarId, entry: SoundEntry): number {
    const sound = this.requireSound();
    return recordedRpmOf(sound.manifest, sound.settings.choices[carId], entry.id);
  }

  private requireSound(): LoadedSound {
    if (!this.sound) throw new Error('AudioManager: the sound manifest is not loaded yet');
    return this.sound;
  }

  private applyLayer(carId: CarId, name: LayerName): void {
    const entry = this.layerEntry(carId, name);
    if (this.local?.carId === carId) this.local.setLayer(name, entry);
    this.remotes?.setLayer(carId, name, entry);
  }

  private async togglePreview(entry: SoundEntry): Promise<boolean> {
    const wasSame = this.preview?.entryId === entry.id;
    this.stopPreview();
    if (wasSame) return false;
    if (this.context.state === 'suspended') await this.context.resume();
    const buffer = await this.loadLoop(entry);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.context.createGain();
    gain.gain.value = 0.9;
    source.connect(gain).connect(this.master);
    source.start();
    this.preview = { entryId: entry.id, source, gain };
    return true;
  }

  private stopPreview(): void {
    if (!this.preview) return;
    const now = this.context.currentTime;
    this.preview.gain.gain.setTargetAtTime(0, now, 0.03);
    this.preview.source.stop(now + 0.2);
    this.preview = null;
  }

  /** Call on a user gesture (the start click). */
  resume(): void {
    if (this.context.state === 'suspended') void this.context.resume();
    this.started = true;
  }

  /** The local car's engine, tyres, wind and scrape, once per rendered frame. */
  updateLocal(frame: LocalEngineFrame): void {
    // Checked before anything else, so a broken caller is named even before the sound has loaded.
    assertFiniteFrame(frame);
    if (!this.started || !this.sound) return;
    if (this.local?.carId !== frame.carId) {
      this.local?.stop();
      const engine = new EngineAudio(frame.carId, this.context, this.master, this.noise, this.loadLoop, (message) => this.reportError(message));
      for (const name of LAYER_NAMES) engine.setLayer(name, this.layerEntry(frame.carId, name));
      this.local = engine;
    }
    const carId = frame.carId;
    this.local.update(frame, this.preview !== null, (entry) => this.recordedRpm(carId, entry));
  }

  /** Engines of the other players, placed where their cars are drawn. */
  updateRemotes(cars: readonly RemoteCarPose[], dt: number): void {
    if (!Number.isFinite(dt)) throw new EngineInputError(`remote engine sound: dt is ${dt}`);
    for (const car of cars) {
      for (const [name, value] of Object.entries(car.position)) {
        if (!Number.isFinite(value)) throw new EngineInputError(`remote engine sound: ${car.id} position.${name} is ${value}`);
      }
    }
    if (!this.started || !this.sound) return;
    if (!this.remotes) {
      this.remotes = new RemoteEngines(
        this.context, this.master, this.loadLoop, (message) => this.reportError(message),
        (carId, name) => this.layerEntry(carId, name), (carId, entry) => this.recordedRpm(carId, entry),
      );
    }
    this.remotes.update(cars, dt);
  }

  /** Remote engines are heard from the camera. */
  setListener(camera: Camera): void {
    camera.getWorldPosition(this.listenerPosition);
    camera.getWorldDirection(this.listenerForward);
    camera.getWorldQuaternion(this.listenerRotation);
    this.listenerUp.set(0, 1, 0).applyQuaternion(this.listenerRotation);
    const listener = this.context.listener;
    const now = this.context.currentTime;
    listener.positionX.setTargetAtTime(this.listenerPosition.x, now, 0.02);
    listener.positionY.setTargetAtTime(this.listenerPosition.y, now, 0.02);
    listener.positionZ.setTargetAtTime(this.listenerPosition.z, now, 0.02);
    listener.forwardX.setTargetAtTime(this.listenerForward.x, now, 0.02);
    listener.forwardY.setTargetAtTime(this.listenerForward.y, now, 0.02);
    listener.forwardZ.setTargetAtTime(this.listenerForward.z, now, 0.02);
    listener.upX.setTargetAtTime(this.listenerUp.x, now, 0.02);
    listener.upY.setTargetAtTime(this.listenerUp.y, now, 0.02);
    listener.upZ.setTargetAtTime(this.listenerUp.z, now, 0.02);
  }

  snapshot(): AudioSnapshot {
    return {
      state: this.context.state,
      started: this.started,
      loaded: this.sound !== null,
      errors: [...this.errors],
      volume: this.master.gain.value,
      local: this.local?.snapshot() ?? null,
      remotes: this.remotes?.snapshot() ?? [],
      pickerOpen: this.picker?.isOpen() ?? false,
      pickerCar: this.picker?.shownCar() ?? null,
      previewing: this.preview?.entryId ?? null,
    };
  }

  /** Short synthesised impact: a noise whoosh + a low thump. */
  knock(): void {
    if (this.context.state !== 'running') return;
    const context = this.context;
    const now = context.currentTime;

    const whoosh = this.noiseSource(false);
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 320;
    band.Q.value = 0.8;
    const whooshGain = context.createGain();
    whooshGain.gain.setValueAtTime(0.6, now);
    whooshGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    whoosh.connect(band).connect(whooshGain).connect(this.master);
    whoosh.start(now);
    whoosh.stop(now + 0.3);

    const thump = context.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(95, now);
    thump.frequency.exponentialRampToValueAtTime(45, now + 0.18);
    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.5, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    thump.connect(thumpGain).connect(this.master);
    thump.start(now);
    thump.stop(now + 0.22);
  }

  /** Short UI blip. */
  ui(): void {
    if (this.context.state !== 'running') return;
    const context = this.context;
    const now = context.currentTime;
    const blip = context.createOscillator();
    blip.type = 'triangle';
    blip.frequency.setValueAtTime(620, now);
    blip.frequency.exponentialRampToValueAtTime(880, now + 0.1);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    blip.connect(gain).connect(this.master);
    blip.start(now);
    blip.stop(now + 0.16);
  }

  /** Kept for API compatibility; routes to the synthesised impact. */
  crash(): void {
    this.knock();
  }
}
