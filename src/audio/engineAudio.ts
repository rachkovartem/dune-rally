// src/audio/engineAudio.ts
import type { Cover } from '../world/biome';
import type { CarId } from '../vehicle/cars';
import { pedalIntent, type DrivetrainSpec, type DrivetrainState } from '../../shared/drivetrain';
import { upAxisOf, type Quaternion } from '../../shared/vehiclePhysics';
import {
  bodyScrapeSpeed, boostTarget, engineLoadTarget, scrapeGain, smoothToward, stepBoost, tyreSound, whistleFrequency, windSound,
} from './engineMix';
import { EngineVoice, type EngineVoiceSnapshot, type LoopLoader, type SoundErrorReport } from './engineVoice';
import type { LayerName, SoundEntry } from './soundManifest';

/** The diesel of the Pajero whistles under boost; the Forester's FB25 breathes without a turbo. */
export const ENGINE_HAS_TURBO: Readonly<Record<CarId, boolean>> = { forester: false, pajero: true };

// How fast the heard load follows the pedal, per second.
const LOAD_RATE = 6;
// Engine level while a loop is previewed in the picker, so the preview is heard over it.
const PREVIEW_ENGINE_LEVEL = 0.12;
const RAMP = 0.04;

export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineInputError';
  }
}

/** Everything the local car's sound needs from one game frame. */
export interface LocalEngineFrame {
  carId: CarId;
  spec: DrivetrainSpec;
  drivetrain: Readonly<DrivetrainState>;
  throttle: number;
  brake: number;
  /** Speed along the nose, m/s; negative when rolling backwards. */
  forwardSpeed: number;
  /** Horizontal speed, m/s. */
  speed: number;
  wheelsInContact: number;
  wheelCount: number;
  cover: Cover;
  rotation: Quaternion;
  /** Height of the body centre above the drawn ground, m. */
  groundClearance: number;
  dt: number;
}

/** A NaN reaching an AudioParam fails with "non-finite value" and no name; this names the field. */
export function assertFiniteFrame(frame: LocalEngineFrame): void {
  const fields: [string, number][] = [
    ['rpm', frame.drivetrain.rpm], ['gear', frame.drivetrain.gear], ['shiftTimer', frame.drivetrain.shiftTimer],
    ['throttle', frame.throttle], ['brake', frame.brake], ['forwardSpeed', frame.forwardSpeed], ['speed', frame.speed],
    ['wheelsInContact', frame.wheelsInContact], ['wheelCount', frame.wheelCount], ['groundClearance', frame.groundClearance],
    ['dt', frame.dt], ['rotation.x', frame.rotation.x], ['rotation.y', frame.rotation.y], ['rotation.z', frame.rotation.z],
    ['rotation.w', frame.rotation.w],
  ];
  for (const [name, value] of fields) {
    if (!Number.isFinite(value)) throw new EngineInputError(`engine sound: ${name} is ${value}`);
  }
  if (frame.drivetrain.rpm <= 0) throw new EngineInputError(`engine sound: rpm must be positive, got ${frame.drivetrain.rpm}`);
  if (frame.dt < 0) throw new EngineInputError(`engine sound: dt must not be negative, got ${frame.dt}`);
}

interface NoiseLayer {
  filter: BiquadFilterNode;
  gain: GainNode;
  source: AudioBufferSourceNode;
}

export interface LocalEngineSnapshot extends EngineVoiceSnapshot {
  carId: CarId;
  gear: number;
  boost: number;
  whistleHz: number;
  turboGain: number;
  breathGain: number;
  tyreGain: number;
  windGain: number;
  scrapeGain: number;
  scrapeSpeed: number;
}

/**
 * The local car heard from the driver's seat: the recorded engine plus intake breath, a turbo
 * whistle (Pajero only), tyre noise by surface for the wheels on the ground, wind and body scrape.
 */
export class EngineAudio {
  private readonly voice: EngineVoice;
  private readonly breath: NoiseLayer;
  private readonly turboHiss: NoiseLayer;
  private readonly turboTone: OscillatorNode;
  private readonly turboToneGain: GainNode;
  private readonly tyres: NoiseLayer;
  private readonly wind: NoiseLayer;
  private readonly scrape: NoiseLayer;
  private readonly outputGains: GainNode[] = [];
  private load = 0;
  private boost = 0;
  private gear = 1;
  private scrapeSpeed = 0;

  constructor(
    readonly carId: CarId,
    private readonly context: AudioContext,
    destination: AudioNode,
    noise: AudioBuffer,
    loadLoop: LoopLoader,
    reportError: SoundErrorReport,
  ) {
    this.voice = new EngineVoice(context, destination, loadLoop, reportError);
    const noiseLayer = (type: BiquadFilterType, frequency: number, q: number): NoiseLayer => {
      const source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(destination);
      source.start(0, Math.random() * noise.duration);
      this.outputGains.push(gain);
      return { filter, gain, source };
    };
    this.breath = noiseLayer('bandpass', 400, 0.8);
    this.turboHiss = noiseLayer('bandpass', 3000, 18);
    this.turboTone = context.createOscillator();
    this.turboTone.type = 'sine';
    this.turboToneGain = context.createGain();
    this.turboToneGain.gain.value = 0;
    this.turboTone.connect(this.turboToneGain).connect(destination);
    this.turboTone.start();
    this.outputGains.push(this.turboToneGain);
    this.tyres = noiseLayer('lowpass', 400, 0.7);
    this.wind = noiseLayer('bandpass', 600, 0.5);
    this.scrape = noiseLayer('bandpass', 1400, 1.2);
  }

  setLayer(name: LayerName, entry: SoundEntry): void {
    this.voice.setLayer(name, entry);
  }

  update(frame: LocalEngineFrame, previewing: boolean, recordedRpmOf: (entry: SoundEntry) => number): void {
    assertFiniteFrame(frame);
    const now = this.context.currentTime;
    const ramp = (param: AudioParam, value: number, timeConstant = RAMP): void => {
      param.setTargetAtTime(value, now, timeConstant);
    };
    const rpm = frame.drivetrain.rpm;
    const intent = pedalIntent(frame.throttle, frame.brake, frame.forwardSpeed);
    this.load = smoothToward(this.load, engineLoadTarget(frame.spec, frame.drivetrain, intent), LOAD_RATE, frame.dt);
    this.gear = frame.drivetrain.gear;
    const level = previewing ? PREVIEW_ENGINE_LEVEL : 0.4 + 0.6 * this.load;
    this.voice.update(rpm, this.load, level, recordedRpmOf);

    const rpmShare = Math.min(1, rpm / frame.spec.engine.cutOffRpm);
    ramp(this.breath.filter.frequency, 250 + rpm * 0.3);
    ramp(this.breath.gain.gain, previewing ? 0 : 0.035 + 0.12 * this.load * rpmShare);

    this.boost = stepBoost(this.boost, boostTarget(ENGINE_HAS_TURBO[this.carId], rpm, this.load), frame.dt);
    const whistle = whistleFrequency(this.boost);
    ramp(this.turboHiss.filter.frequency, whistle);
    ramp(this.turboTone.frequency, whistle * 1.02);
    ramp(this.turboHiss.gain.gain, previewing ? 0 : 0.25 * this.boost * this.boost);
    ramp(this.turboToneGain.gain, previewing ? 0 : 0.012 * this.boost * this.boost);

    const tyre = tyreSound(frame.cover, frame.speed, frame.wheelsInContact, frame.wheelCount);
    ramp(this.tyres.filter.frequency, tyre.frequency);
    ramp(this.tyres.gain.gain, previewing ? 0 : tyre.gain);
    const wind = windSound(frame.speed);
    ramp(this.wind.filter.frequency, wind.frequency);
    ramp(this.wind.gain.gain, previewing ? 0 : wind.gain);
    this.scrapeSpeed = bodyScrapeSpeed({
      upY: upAxisOf(frame.rotation).y,
      wheelsInContact: frame.wheelsInContact,
      groundClearance: frame.groundClearance,
      speed: frame.speed,
    });
    ramp(this.scrape.gain.gain, previewing ? 0 : scrapeGain(this.scrapeSpeed), 0.02);
  }

  snapshot(): LocalEngineSnapshot {
    return {
      ...this.voice.snapshot(),
      carId: this.carId,
      gear: this.gear,
      boost: this.boost,
      whistleHz: whistleFrequency(this.boost),
      turboGain: this.turboHiss.gain.gain.value,
      breathGain: this.breath.gain.gain.value,
      tyreGain: this.tyres.gain.gain.value,
      windGain: this.wind.gain.gain.value,
      scrapeGain: this.scrape.gain.gain.value,
      scrapeSpeed: this.scrapeSpeed,
    };
  }

  stop(): void {
    this.voice.stop();
    const now = this.context.currentTime;
    for (const gain of this.outputGains) gain.gain.setTargetAtTime(0, now, 0.03);
    for (const layer of [this.breath, this.turboHiss, this.tyres, this.wind, this.scrape]) layer.source.stop(now + 0.3);
    this.turboTone.stop(now + 0.3);
  }
}
