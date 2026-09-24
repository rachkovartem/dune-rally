// src/audio/engineVoice.ts
import { layerWeights, playbackRateFor, type LayerWeights } from './engineMix';
import { LAYER_NAMES, type LayerName, type SoundEntry } from './soundManifest';

/** Gives the decoded loop for an entry; the same promise for the same entry, so voices share buffers. */
export type LoopLoader = (entry: SoundEntry) => Promise<AudioBuffer>;
export type SoundErrorReport = (message: string) => void;

// Time constants (s) of the parameter ramps: short enough to follow a gear change, long enough not to click.
const LEVEL_RAMP = 0.04;
const RATE_RAMP = 0.02;
const SWAP_RAMP = 0.03;

interface LayerSlot {
  weight: GainNode;
  entry: SoundEntry | null;
  source: AudioBufferSourceNode | null;
  sourceGain: GainNode | null;
  rate: number;
}

export interface EngineVoiceSnapshot {
  rpm: number;
  load: number;
  level: number;
  toneHz: number;
  layerIds: Record<LayerName, string | null>;
  weights: LayerWeights;
  rates: Record<LayerName, number>;
  /** Gains actually on the audio nodes now, after the ramps. */
  weightValues: Record<LayerName, number>;
  playing: Record<LayerName, boolean>;
}

/**
 * One car's engine: four recorded loops (idle, low, mid, high) crossfaded and pitched by rpm, under
 * a low-pass that opens with load, so off-throttle sounds muffled and on-throttle sounds open.
 */
export class EngineVoice {
  private readonly bus: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly slots: Record<LayerName, LayerSlot>;
  private last: EngineVoiceSnapshot;

  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
    private readonly loadLoop: LoopLoader,
    private readonly reportError: SoundErrorReport,
  ) {
    this.bus = context.createGain();
    this.bus.gain.value = 0;
    this.tone = context.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.5;
    this.bus.connect(this.tone).connect(destination);
    const slot = (): LayerSlot => {
      const weight = context.createGain();
      weight.gain.value = 0;
      weight.connect(this.bus);
      return { weight, entry: null, source: null, sourceGain: null, rate: 1 };
    };
    this.slots = { idle: slot(), low: slot(), mid: slot(), high: slot() };
    this.last = {
      rpm: 0, load: 0, level: 0, toneHz: this.tone.frequency.value,
      layerIds: { idle: null, low: null, mid: null, high: null },
      weights: { idle: 0, low: 0, mid: 0, high: 0 },
      rates: { idle: 1, low: 1, mid: 1, high: 1 },
      weightValues: { idle: 0, low: 0, mid: 0, high: 0 },
      playing: { idle: false, low: false, mid: false, high: false },
    };
  }

  /** Swaps the loop on one layer while the engine runs: the new one fades in as the old one fades out. */
  setLayer(name: LayerName, entry: SoundEntry): void {
    const slot = this.slots[name];
    if (slot.entry?.id === entry.id) return;
    slot.entry = entry;
    this.loadLoop(entry).then((buffer) => {
      // A newer choice or a stopped voice arrived while this one decoded.
      if (slot.entry?.id !== entry.id) return;
      const now = this.context.currentTime;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = slot.rate;
      const sourceGain = this.context.createGain();
      sourceGain.gain.value = 0;
      sourceGain.gain.setTargetAtTime(1, now, SWAP_RAMP);
      source.connect(sourceGain).connect(slot.weight);
      // A random start point keeps two cars on the same loop from playing in step.
      source.start(0, Math.random() * buffer.duration);
      this.fadeOut(slot);
      slot.source = source;
      slot.sourceGain = sourceGain;
    }, (error: unknown) => {
      this.reportError(`${name} layer "${entry.id}" did not load: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private fadeOut(slot: LayerSlot): void {
    if (!slot.source || !slot.sourceGain) return;
    const now = this.context.currentTime;
    slot.sourceGain.gain.setTargetAtTime(0, now, SWAP_RAMP);
    slot.source.stop(now + 0.2);
    slot.source = null;
    slot.sourceGain = null;
  }

  /**
   * `level` is the engine's loudness before the crossfade; `recordedRpmOf` gives the rpm each
   * chosen loop was recorded at, so a player's correction in the picker is heard at once.
   */
  update(rpm: number, load: number, level: number, recordedRpmOf: (entry: SoundEntry) => number): void {
    const now = this.context.currentTime;
    const recorded: Record<LayerName, number> = { idle: 0, low: 0, mid: 0, high: 0 };
    for (const name of LAYER_NAMES) {
      const entry = this.slots[name].entry;
      if (!entry) throw new Error(`EngineVoice.update: the ${name} layer has no loop chosen`);
      recorded[name] = recordedRpmOf(entry);
    }
    const weights = layerWeights(rpm, recorded);
    const toneHz = 1400 + 9000 * load * Math.min(1, rpm / 3000);
    this.bus.gain.setTargetAtTime(level, now, LEVEL_RAMP);
    this.tone.frequency.setTargetAtTime(toneHz, now, LEVEL_RAMP);
    const rates: Record<LayerName, number> = { idle: 1, low: 1, mid: 1, high: 1 };
    for (const name of LAYER_NAMES) {
      const slot = this.slots[name];
      slot.weight.gain.setTargetAtTime(weights[name], now, LEVEL_RAMP);
      slot.rate = playbackRateFor(rpm, recorded[name]);
      rates[name] = slot.rate;
      slot.source?.playbackRate.setTargetAtTime(slot.rate, now, RATE_RAMP);
    }
    this.last = { ...this.snapshotNodes(), rpm, load, level, toneHz, weights, rates };
  }

  private snapshotNodes(): Pick<EngineVoiceSnapshot, 'layerIds' | 'weightValues' | 'playing'> {
    const layerIds: Record<LayerName, string | null> = { idle: null, low: null, mid: null, high: null };
    const weightValues: Record<LayerName, number> = { idle: 0, low: 0, mid: 0, high: 0 };
    const playing: Record<LayerName, boolean> = { idle: false, low: false, mid: false, high: false };
    for (const name of LAYER_NAMES) {
      const slot = this.slots[name];
      layerIds[name] = slot.entry?.id ?? null;
      weightValues[name] = slot.weight.gain.value;
      playing[name] = slot.source !== null;
    }
    return { layerIds, weightValues, playing };
  }

  snapshot(): EngineVoiceSnapshot {
    return { ...this.last, ...this.snapshotNodes() };
  }

  /** Fades the engine out and frees its nodes. */
  stop(): void {
    for (const name of LAYER_NAMES) {
      const slot = this.slots[name];
      this.fadeOut(slot);
      slot.entry = null;
    }
    const now = this.context.currentTime;
    this.bus.gain.setTargetAtTime(0, now, SWAP_RAMP);
    setTimeout(() => this.tone.disconnect(), 300);
  }
}
