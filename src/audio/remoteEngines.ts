// src/audio/remoteEngines.ts
import type { CarId } from '../vehicle/cars';
import { vehicleConfigFor } from '../vehicle/vehicleConfig';
import {
  createDrivetrainState, pedalIntent, stepGearbox, type DrivetrainSpec, type DrivetrainState,
} from '../../shared/drivetrain';
import { forwardAxisOf, type Quaternion } from '../../shared/vehiclePhysics';
import { engineLoadTarget, smoothToward } from './engineMix';
import { EngineVoice, type LoopLoader, type SoundErrorReport } from './engineVoice';
import { LAYER_NAMES, type LayerName, type SoundEntry } from './soundManifest';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Where a remote car is drawn this frame; the server sends no rpm, so it is estimated from motion. */
export interface RemoteCarPose {
  id: string;
  carId: CarId;
  position: Point3;
  rotation: Quaternion;
}

// Speed along the nose changing faster than this (m/s²) is read as a pedal pressed.
const PEDAL_ACCELERATION = 0.4;
// Per second: speed is smoothed harder than the acceleration read from it, so network jitter is not heard as throttle.
const SPEED_SMOOTHING = 8;
const ACCELERATION_SMOOTHING = 4;
// A remote car is heard at half the local engine's level, and a distance of this many metres gives full level.
const REMOTE_LEVEL = 0.5;
const REFERENCE_DISTANCE = 8;
const MAX_DISTANCE = 300;

/**
 * Runs the car's own gearbox on a speed read from the drawn motion, so a remote Pajero shifts and
 * a remote Forester holds its CVT rpm like the local ones do. Pure: no Web Audio.
 */
export class RemoteDrivetrainEstimate {
  private state: DrivetrainState;
  private lastPosition: Point3 | null = null;
  private forwardSpeed = 0;
  private acceleration = 0;
  private load = 0;

  constructor(private readonly spec: DrivetrainSpec) {
    this.state = createDrivetrainState(spec);
  }

  step(position: Point3, rotation: Quaternion, dt: number): { rpm: number; gear: number; load: number; forwardSpeed: number } {
    if (dt > 0 && this.lastPosition) {
      const forward = forwardAxisOf(rotation);
      const alongNose = ((position.x - this.lastPosition.x) * forward.x
        + (position.y - this.lastPosition.y) * forward.y
        + (position.z - this.lastPosition.z) * forward.z) / dt;
      // A teleport or a reset would read as an impossible speed for one frame.
      const limit = this.spec.topSpeed * 1.2;
      const measured = Math.max(-limit, Math.min(limit, alongNose));
      const previous = this.forwardSpeed;
      this.forwardSpeed = smoothToward(this.forwardSpeed, measured, SPEED_SMOOTHING, dt);
      this.acceleration = smoothToward(this.acceleration, (this.forwardSpeed - previous) / dt, ACCELERATION_SMOOTHING, dt);
    }
    this.lastPosition = { x: position.x, y: position.y, z: position.z };
    const speedingUp = this.forwardSpeed >= 0 ? this.acceleration > PEDAL_ACCELERATION : this.acceleration < -PEDAL_ACCELERATION;
    const intent = this.forwardSpeed >= 0
      ? pedalIntent(speedingUp ? 1 : 0, 0, this.forwardSpeed)
      : pedalIntent(0, speedingUp ? 1 : 0, this.forwardSpeed);
    if (dt > 0) {
      this.state = stepGearbox(this.spec, this.state, intent, this.forwardSpeed, dt);
      this.load = smoothToward(this.load, engineLoadTarget(this.spec, this.state, intent), 6, dt);
    }
    return { rpm: this.state.rpm, gear: this.state.gear, load: this.load, forwardSpeed: this.forwardSpeed };
  }
}

interface RemoteEngine {
  carId: CarId;
  voice: EngineVoice;
  panner: PannerNode;
  estimate: RemoteDrivetrainEstimate;
  last: { rpm: number; gear: number; load: number; forwardSpeed: number };
}

export interface RemoteEngineSnapshot {
  id: string;
  carId: CarId;
  rpm: number;
  gear: number;
  load: number;
  forwardSpeed: number;
}

/** A quieter engine per remote car, placed in space with a panner so it fades with distance. */
export class RemoteEngines {
  private readonly engines = new Map<string, RemoteEngine>();

  constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
    private readonly loadLoop: LoopLoader,
    private readonly reportError: SoundErrorReport,
    private readonly layerEntry: (carId: CarId, name: LayerName) => SoundEntry,
    private readonly recordedRpmOf: (carId: CarId, entry: SoundEntry) => number,
  ) {}

  private create(carId: CarId): RemoteEngine {
    const panner = this.context.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = REFERENCE_DISTANCE;
    panner.maxDistance = MAX_DISTANCE;
    panner.rolloffFactor = 1;
    panner.connect(this.destination);
    const voice = new EngineVoice(this.context, panner, this.loadLoop, this.reportError);
    for (const name of LAYER_NAMES) voice.setLayer(name, this.layerEntry(carId, name));
    const estimate = new RemoteDrivetrainEstimate(vehicleConfigFor(carId).drivetrain);
    return { carId, voice, panner, estimate, last: { rpm: 0, gear: 1, load: 0, forwardSpeed: 0 } };
  }

  private drop(id: string, engine: RemoteEngine): void {
    engine.voice.stop();
    setTimeout(() => engine.panner.disconnect(), 300);
    this.engines.delete(id);
  }

  update(cars: readonly RemoteCarPose[], dt: number): void {
    const seen = new Set<string>();
    for (const car of cars) {
      seen.add(car.id);
      let engine = this.engines.get(car.id);
      if (engine && engine.carId !== car.carId) {
        this.drop(car.id, engine);
        engine = undefined;
      }
      if (!engine) {
        engine = this.create(car.carId);
        this.engines.set(car.id, engine);
      }
      const estimated = engine.estimate.step(car.position, car.rotation, dt);
      engine.last = estimated;
      const now = this.context.currentTime;
      engine.panner.positionX.setTargetAtTime(car.position.x, now, 0.02);
      engine.panner.positionY.setTargetAtTime(car.position.y, now, 0.02);
      engine.panner.positionZ.setTargetAtTime(car.position.z, now, 0.02);
      const carId = engine.carId;
      engine.voice.update(estimated.rpm, estimated.load, REMOTE_LEVEL * (0.4 + 0.6 * estimated.load), (entry) => this.recordedRpmOf(carId, entry));
    }
    for (const [id, engine] of this.engines) {
      if (!seen.has(id)) this.drop(id, engine);
    }
  }

  /** The player changed a loop in the picker: every remote car of that model follows. */
  setLayer(carId: CarId, name: LayerName, entry: SoundEntry): void {
    for (const engine of this.engines.values()) {
      if (engine.carId === carId) engine.voice.setLayer(name, entry);
    }
  }

  snapshot(): RemoteEngineSnapshot[] {
    return [...this.engines].map(([id, engine]) => ({ id, carId: engine.carId, ...engine.last }));
  }
}
