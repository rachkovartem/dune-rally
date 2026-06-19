// src/audio/audio.ts
import { vehicleConfig } from '../vehicle/vehicleConfig';

const FILES = {
  engine: '/sounds/engine.mp3',
  wind: '/sounds/wind.ogg',
  wood: '/sounds/wood.ogg',
  crash: '/sounds/crash.ogg',
  pop: '/sounds/pop.ogg',
} as const;

type Sound = keyof typeof FILES;

/**
 * Web Audio sound: a looping engine whose pitch/volume track speed, a wind loop that rises with
 * speed, and one-shots (tree-knock, crash, UI). Must be resumed on a user gesture (autoplay policy).
 */
export class AudioManager {
  private ctx: AudioContext;
  private master: GainNode;
  private buffers: Partial<Record<Sound, AudioBuffer>> = {};
  private loaded = false;
  private want = false;
  private engineSrc?: AudioBufferSourceNode;
  private engineGain?: GainNode;
  private windGain?: GainNode;

  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    void this.load();
  }

  private async load(): Promise<void> {
    await Promise.all(
      (Object.keys(FILES) as Sound[]).map(async (k) => {
        try {
          const res = await fetch(FILES[k]);
          this.buffers[k] = await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          /* a missing sound just stays silent */
        }
      }),
    );
    this.loaded = true;
    if (this.want) this.startLoops();
  }

  /** Call on a user gesture (the start click) to satisfy the browser autoplay policy. */
  resume(): void {
    this.want = true;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.loaded) this.startLoops();
  }

  private loop(buffer: AudioBuffer): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(gain);
    src.start();
    return gain;
  }

  private startLoops(): void {
    if (this.engineSrc || !this.buffers.engine) return; // start once
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.master);
    this.engineSrc = this.ctx.createBufferSource();
    this.engineSrc.buffer = this.buffers.engine;
    this.engineSrc.loop = true;
    this.engineSrc.connect(this.engineGain);
    this.engineSrc.start();
    if (this.buffers.wind) this.windGain = this.loop(this.buffers.wind);
  }

  /** Drive the engine + wind from the car's speed and throttle. */
  setDrive(speed: number, throttle: number): void {
    if (!this.engineSrc || !this.engineGain) return;
    const f = Math.min(1, speed / vehicleConfig.maxSpeed);
    const t = this.ctx.currentTime;
    this.engineSrc.playbackRate.setTargetAtTime(0.7 + f * 1.5, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.12 + throttle * 0.22 + f * 0.16, t, 0.1);
    this.windGain?.gain.setTargetAtTime(Math.min(0.5, f * f * 0.6), t, 0.15);
  }

  private oneShot(s: Sound, vol: number): void {
    const buf = this.buffers[s];
    if (!buf || this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(this.master);
    src.start();
  }

  knock(): void { this.oneShot('wood', 0.85); }
  crash(): void { this.oneShot('crash', 0.9); }
  ui(): void { this.oneShot('pop', 0.5); }
}
