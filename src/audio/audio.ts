// src/audio/audio.ts
import { vehicleConfig } from '../vehicle/vehicleConfig';

/**
 * Fully procedural sound (Web Audio) — no files, so nothing loops with a seam and every parameter
 * is tunable. The engine is built from detuned sawtooth oscillators + a sub + combustion noise +
 * a firing-rate tremolo, all driven by speed/throttle; wind is filtered noise; knock and UI are
 * short synthesised one-shots. Must be resumed on a user gesture (autoplay policy).
 */
export class AudioManager {
  private ctx: AudioContext;
  private master: GainNode;
  private noise: AudioBuffer;
  private started = false;

  // engine graph
  private lp!: BiquadFilterNode;
  private engineGain!: GainNode;
  private osc1!: OscillatorNode;
  private osc2!: OscillatorNode;
  private sub!: OscillatorNode;
  private lfo!: OscillatorNode;
  private trem!: GainNode;
  private combGain!: GainNode;
  private windGain?: GainNode;
  private windLP?: BiquadFilterNode;
  private tireGain?: GainNode;
  private tireBP?: BiquadFilterNode;

  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    this.noise = this.makeNoise(2);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private noiseSource(loop: boolean): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = loop;
    return n;
  }

  /** Call on a user gesture (the start click). */
  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.started) return;
    this.started = true;
    this.buildEngine();
    this.buildWind();
    this.buildTire();
  }

  private buildTire(): void {
    const c = this.ctx;
    const src = this.noiseSource(true);
    this.tireBP = c.createBiquadFilter();
    this.tireBP.type = 'bandpass';
    this.tireBP.frequency.value = 480;
    this.tireBP.Q.value = 0.6;
    this.tireGain = c.createGain();
    this.tireGain.gain.value = 0;
    src.connect(this.tireBP);
    this.tireBP.connect(this.tireGain);
    this.tireGain.connect(this.master);
    src.start();
  }

  private buildEngine(): void {
    const c = this.ctx;
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 500;
    this.lp.Q.value = 5;

    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.lp.connect(this.engineGain);
    this.engineGain.connect(this.master);

    this.osc1 = c.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 36;
    this.osc1.connect(this.lp);
    this.osc1.start();

    this.osc2 = c.createOscillator();
    this.osc2.type = 'sawtooth';
    this.osc2.frequency.value = 36.3;
    this.osc2.connect(this.lp);
    this.osc2.start();

    this.sub = c.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = 18;
    const subG = c.createGain();
    subG.gain.value = 0.5;
    this.sub.connect(subG);
    subG.connect(this.lp);
    this.sub.start();

    // combustion roughness
    const comb = this.noiseSource(true);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 280;
    bp.Q.value = 1.2;
    this.combGain = c.createGain();
    this.combGain.gain.value = 0;
    comb.connect(bp);
    bp.connect(this.combGain);
    this.combGain.connect(this.engineGain);
    comb.start();

    // firing-rate tremolo modulating the engine gain (the "brap" pulse)
    this.lfo = c.createOscillator();
    this.lfo.type = 'sawtooth';
    this.lfo.frequency.value = 20;
    this.trem = c.createGain();
    this.trem.gain.value = 0;
    this.lfo.connect(this.trem);
    this.trem.connect(this.engineGain.gain);
    this.lfo.start();
  }

  private buildWind(): void {
    const c = this.ctx;
    const src = this.noiseSource(true);
    this.windLP = c.createBiquadFilter();
    this.windLP.type = 'lowpass';
    this.windLP.frequency.value = 500;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windLP);
    this.windLP.connect(this.windGain);
    this.windGain.connect(this.master);
    src.start();
  }

  /** Drive the engine + wind from the car's speed and throttle. */
  setDrive(speed: number, throttle: number): void {
    if (!this.started) return;
    const f = Math.min(1, speed / vehicleConfig.maxSpeed);
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.08) => p.setTargetAtTime(v, t, tc);

    const fund = 36 + f * 105; // fundamental rises with speed
    set(this.osc1.frequency, fund);
    set(this.osc2.frequency, fund * 1.008);
    set(this.sub.frequency, fund * 0.5);
    set(this.lp.frequency, 420 + f * 2000);

    // Engine is heard ONLY while accelerating — release the throttle and it fades out.
    const base = throttle * (0.18 + f * 0.05);
    set(this.engineGain.gain, base);
    set(this.trem.gain, base * 0.6);            // tremolo depth scales with loudness
    set(this.lfo.frequency, 18 + f * 60);       // firing rate
    set(this.combGain.gain, throttle * 0.07);

    // Tyre roll — the rustle you hear whenever the car moves; the ONLY sound while coasting.
    this.tireGain?.gain.setTargetAtTime(Math.min(0.32, f * 0.42), t, 0.1);
    this.tireBP?.frequency.setTargetAtTime(380 + f * 520, t, 0.12);

    this.windGain?.gain.setTargetAtTime(Math.min(0.3, f * f * 0.4), t, 0.15);
    this.windLP?.frequency.setTargetAtTime(450 + f * 1400, t, 0.15);
  }

  /** Short synthesised impact: a noise whoosh + a low thump. */
  knock(): void {
    if (this.ctx.state !== 'running') return;
    const c = this.ctx;
    const t = c.currentTime;

    const n = this.noiseSource(false);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320;
    bp.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    n.connect(bp); bp.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.3);

    const thump = c.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(95, t);
    thump.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const tg = c.createGain();
    tg.gain.setValueAtTime(0.5, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    thump.connect(tg); tg.connect(this.master);
    thump.start(t); thump.stop(t + 0.22);
  }

  /** Short UI blip. */
  ui(): void {
    if (this.ctx.state !== 'running') return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.16);
  }

  /** Kept for API compatibility; routes to the synthesised impact. */
  crash(): void {
    this.knock();
  }
}
