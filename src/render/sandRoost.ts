// src/render/sandRoost.ts
// Sand and dirt thrown up by the tyres: back from a spinning driven wheel, and out to the side
// from a wheel sliding sideways. Heavy grains fly and fall; a light dust puff grows and hangs.
// Each kind is one instanced mesh with a fixed pool, so the whole roost costs two draw calls.
import * as THREE from 'three';
import type { Cover } from '../world/biome';
import type { LinearColor } from './farTerrain';
import type { QualityName } from './qualityTiers';

/** Only loose ground is thrown; road, salt crust and rock are not. */
export const ROOST_COVERS: ReadonlySet<Cover> = new Set<Cover>(['sand', 'beach', 'dirt', 'gravel', 'mud', 'snow']);

/** Share of the full emission rate per quality tier. */
export const ROOST_SHARE_BY_QUALITY: Readonly<Record<QualityName, number>> = { high: 1, medium: 0.5 };

const ROOST = {
  /** Below this wheelspin (m/s) a tyre throws nothing. */
  minSpin: 1,
  /** Below this sideways slide (m/s) a tyre throws nothing to the side. */
  minSlide: 1.5,
  /** Share of the tread speed a grain leaves with. */
  throwShare: 0.8,
  /** Share of the sideways slide a grain leaves with. */
  slideShare: 0.6,
  /** Share of the car's own velocity a grain keeps. */
  carVelocityShare: 0.6,
  scatter: 0.9,
  gravity: 9.81,
  /** A particle this far under the ground it started from has landed. */
  landDepth: 0.08,
  /** Brightness spread between particles. */
  shadeSpread: 0.18,
} as const;

interface ParticleKind {
  poolSize: number;
  /** Particles per second per m/s of spin (or slide) above the threshold, for one wheel. */
  perSlipSecond: number;
  /** Most particles one wheel may start in one frame, so a long frame does not empty the pool. */
  maxPerWheelFrame: number;
  life: { min: number; max: number };
  size: { min: number; max: number };
  /** Size at the end of the life as a multiple of the start size (dust spreads out). */
  growth: number;
  /** Share of the throw speed this kind leaves with. */
  speedShare: number;
  lift: { min: number; max: number; perSpin: number };
  /** Share of the gravity this kind feels (dust hangs). */
  gravityShare: number;
  /** Drag per second on the speed. */
  drag: number;
  /** Brightness of this kind against the ground colour (dust in the sun reads lighter). */
  brightness: number;
  /** A flat soft sprite turned to the camera instead of a solid grain. */
  billboard: boolean;
}

// Grains are lit, but a grain's shaded side faces the chase camera, so they are drawn a little
// brighter than the ground to read as sand and not as stones.
const GRAINS: ParticleKind = {
  poolSize: 1400,
  perSlipSecond: 60,
  maxPerWheelFrame: 12,
  life: { min: 0.5, max: 1.1 },
  size: { min: 0.018, max: 0.045 },
  growth: 1,
  speedShare: 1,
  lift: { min: 1.2, max: 3.4, perSpin: 0.15 },
  gravityShare: 1,
  drag: 1.6,
  brightness: 1.5,
  billboard: false,
};

// The dust sprite is unlit, so its colour is the ground albedo times roughly what the sun and the
// sky give the sand around it; tuned by eye against the lit sand in a screenshot.
const DUST: ParticleKind = {
  poolSize: 200,
  perSlipSecond: 6,
  maxPerWheelFrame: 2,
  life: { min: 0.9, max: 1.6 },
  size: { min: 0.3, max: 0.5 },
  growth: 3,
  speedShare: 0.35,
  lift: { min: 0.4, max: 1.1, perSpin: 0.05 },
  gravityShare: 0.05,
  drag: 2.5,
  brightness: 2.4,
  billboard: true,
};

const DUST_OPACITY = 0.3;

/** A disc that fades to clear at its edge, for the dust sprite's alpha map. */
function softDiscTexture(): THREE.Texture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const distance = Math.hypot(column + 0.5 - size / 2, row + 0.5 - size / 2) / (size / 2);
      const alpha = Math.max(0, 1 - distance) ** 2;
      const offset = (row * size + column) * 4;
      // An alpha map is read from the green channel, so the fade goes into the colour bytes.
      const level = Math.round(alpha * 255);
      data.set([level, level, level, 255], offset);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

/** One wheel as the roost sees it. */
export interface RoostWheel {
  /** Contact point in world space; null for a wheel in the air. */
  contact: { x: number; y: number; z: number } | null;
  /** Wheelspin of this wheel, m/s (0 when not driven). */
  spinSpeed: number;
  /** Sideways slide of this wheel, m/s. */
  lateralSlip: number;
}

export interface RoostFrame {
  wheels: readonly RoostWheel[];
  /** The way the driven tyres spin: 1 forward, -1 backward. */
  spinDirection: 1 | -1;
  /** The car's nose and its left (+X), unit vectors in world space. */
  forward: { x: number; y: number; z: number };
  left: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  cover: Cover;
  /** Colour of the ground under the car, linear. */
  groundColor: LinearColor;
  /** The camera's rotation, so the dust sprites face it. */
  cameraRotation: THREE.Quaternion;
  dt: number;
}

interface Throw {
  x: number;
  y: number;
  z: number;
  /** Velocity before this kind's own share and lift. */
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  spin: number;
  color: LinearColor;
}

const IDENTITY = new THREE.Quaternion();

const random = (min: number, max: number): number => min + Math.random() * (max - min);

/** A fixed pool of one particle kind; live particles are packed at the front of every array. */
class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly colorAttribute: THREE.InstancedBufferAttribute;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly color: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly floor: Float32Array;
  live = 0;

  constructor(scene: THREE.Scene, private readonly kind: ParticleKind, geometry: THREE.BufferGeometry, material: THREE.Material) {
    const count = kind.poolSize;
    this.position = new Float32Array(count * 3);
    this.velocity = new Float32Array(count * 3);
    this.color = new Float32Array(count * 3);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.size = new Float32Array(count);
    this.floor = new Float32Array(count);
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.colors = new Float32Array(count * 3);
    this.colorAttribute = new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colorAttribute;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const matrices = this.mesh.instanceMatrix.array;
    if (!(matrices instanceof Float32Array)) throw new Error('SandRoost: the instance matrices are not a Float32Array');
    this.matrices = matrices;
    this.mesh.count = 0;
    // The particles move every frame; a bounding sphere for them would be stale at once.
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  spawn(from: Throw): void {
    if (this.live >= this.kind.poolSize) return;
    const index = this.live++;
    const offset = index * 3;
    const kind = this.kind;
    this.position[offset] = from.x;
    this.position[offset + 1] = from.y;
    this.position[offset + 2] = from.z;
    this.velocity[offset] = from.velocityX * kind.speedShare;
    this.velocity[offset + 1] = from.velocityY * kind.speedShare + random(kind.lift.min, kind.lift.max) + kind.lift.perSpin * from.spin;
    this.velocity[offset + 2] = from.velocityZ * kind.speedShare;
    const shade = kind.brightness * (1 + random(-ROOST.shadeSpread, ROOST.shadeSpread));
    this.color[offset] = from.color.r * shade;
    this.color[offset + 1] = from.color.g * shade;
    this.color[offset + 2] = from.color.b * shade;
    this.age[index] = 0;
    this.life[index] = random(kind.life.min, kind.life.max);
    this.size[index] = random(kind.size.min, kind.size.max);
    this.floor[index] = from.y - ROOST.landDepth;
  }

  step(dt: number): void {
    const keep = Math.max(0, 1 - this.kind.drag * dt);
    const fall = ROOST.gravity * this.kind.gravityShare * dt;
    let index = 0;
    while (index < this.live) {
      const offset = index * 3;
      this.age[index] += dt;
      this.velocity[offset] *= keep;
      this.velocity[offset + 1] = this.velocity[offset + 1] * keep - fall;
      this.velocity[offset + 2] *= keep;
      this.position[offset] += this.velocity[offset] * dt;
      this.position[offset + 1] = Math.max(this.floor[index], this.position[offset + 1] + this.velocity[offset + 1] * dt);
      this.position[offset + 2] += this.velocity[offset + 2] * dt;
      const landed = this.kind.gravityShare >= 1 && this.position[offset + 1] <= this.floor[index];
      if (this.age[index] >= this.life[index] || landed) {
        this.remove(index);
        continue;
      }
      index++;
    }
  }

  /** The last live particle takes the place of the dead one, so the live ones stay packed. */
  private remove(index: number): void {
    const last = --this.live;
    if (index === last) return;
    for (let axis = 0; axis < 3; axis++) {
      this.position[index * 3 + axis] = this.position[last * 3 + axis];
      this.velocity[index * 3 + axis] = this.velocity[last * 3 + axis];
      this.color[index * 3 + axis] = this.color[last * 3 + axis];
    }
    this.age[index] = this.age[last];
    this.life[index] = this.life[last];
    this.size[index] = this.size[last];
    this.floor[index] = this.floor[last];
  }

  private readonly facing = new THREE.Matrix4();

  write(cameraRotation: THREE.Quaternion): void {
    // Column-major rotation part: a sprite takes the camera's rotation, a grain none (it is round).
    const rotation = this.facing.makeRotationFromQuaternion(this.kind.billboard ? cameraRotation : IDENTITY).elements;
    for (let index = 0; index < this.live; index++) {
      const offset = index * 3;
      const lived = this.age[index] / this.life[index];
      // Particles shrink over the last third of their life instead of popping out.
      const scale = this.size[index] * (1 + (this.kind.growth - 1) * lived) * Math.min(1, (1 - lived) * 3);
      const matrix = index * 16;
      for (let element = 0; element < 12; element++) this.matrices[matrix + element] = rotation[element] * scale;
      this.matrices[matrix + 12] = this.position[offset];
      this.matrices[matrix + 13] = this.position[offset + 1];
      this.matrices[matrix + 14] = this.position[offset + 2];
      this.matrices[matrix + 15] = 1;
      this.colors[offset] = this.color[offset];
      this.colors[offset + 1] = this.color[offset + 1];
      this.colors[offset + 2] = this.color[offset + 2];
    }
    this.mesh.count = this.live;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.live * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colorAttribute.clearUpdateRanges();
    this.colorAttribute.addUpdateRange(0, this.live * 3);
    this.colorAttribute.needsUpdate = true;
  }
}

export class SandRoost {
  private readonly grains: ParticlePool;
  private readonly dust: ParticlePool;
  private share: number = ROOST_SHARE_BY_QUALITY.high;
  /** Per wheel, the fraction of a particle each kind still owes from earlier frames. */
  private owed: { grains: number; dust: number }[] = [];

  constructor(scene: THREE.Scene) {
    this.grains = new ParticlePool(scene, GRAINS, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }));
    const dustMaterial = new THREE.MeshBasicMaterial({
      alphaMap: softDiscTexture(), transparent: true, opacity: DUST_OPACITY, depthWrite: false, fog: true,
    });
    this.dust = new ParticlePool(scene, DUST, new THREE.PlaneGeometry(1, 1), dustMaterial);
    this.dust.mesh.renderOrder = 2;
  }

  setQuality(name: QualityName): void {
    this.share = ROOST_SHARE_BY_QUALITY[name];
  }

  /** Particles alive now (grains and dust), for the debug hook. */
  liveCount(): number {
    return this.grains.live + this.dust.live;
  }

  update(frame: RoostFrame): void {
    if (ROOST_COVERS.has(frame.cover)) this.emit(frame);
    for (const pool of [this.grains, this.dust]) {
      pool.step(frame.dt);
      pool.write(frame.cameraRotation);
    }
  }

  private emit(frame: RoostFrame): void {
    const sideSpeed = frame.velocity.x * frame.left.x + frame.velocity.y * frame.left.y + frame.velocity.z * frame.left.z;
    const slideSign = Math.sign(sideSpeed);
    if (this.owed.length !== frame.wheels.length) this.owed = frame.wheels.map(() => ({ grains: 0, dust: 0 }));
    frame.wheels.forEach((wheel, wheelIndex) => {
      const owed = this.owed[wheelIndex];
      const contact = wheel.contact;
      const slip = Math.max(0, wheel.spinSpeed - ROOST.minSpin) + Math.max(0, wheel.lateralSlip - ROOST.minSlide);
      if (!contact || slip === 0) {
        owed.grains = 0;
        owed.dust = 0;
        return;
      }
      // The tread moves back against the ground while the wheel spins forward, so the sand flies back.
      const throwSpeed = -frame.spinDirection * wheel.spinSpeed * ROOST.throwShare;
      const slideSpeed = slideSign * wheel.lateralSlip * ROOST.slideShare;
      const emit = (pool: ParticlePool, kind: ParticleKind, key: 'grains' | 'dust'): void => {
        const due = owed[key] + slip * kind.perSlipSecond * this.share * frame.dt;
        const count = Math.min(kind.maxPerWheelFrame, Math.floor(due));
        owed[key] = due - Math.floor(due);
        for (let particle = 0; particle < count; particle++) {
          const along = throwSpeed * random(0.6, 1.2);
          const across = slideSpeed + random(-ROOST.scatter, ROOST.scatter);
          pool.spawn({
            x: contact.x, y: contact.y + 0.03, z: contact.z,
            velocityX: frame.forward.x * along + frame.left.x * across + frame.velocity.x * ROOST.carVelocityShare,
            velocityY: frame.forward.y * along + frame.left.y * across + frame.velocity.y * ROOST.carVelocityShare,
            velocityZ: frame.forward.z * along + frame.left.z * across + frame.velocity.z * ROOST.carVelocityShare,
            spin: wheel.spinSpeed,
            color: frame.groundColor,
          });
        }
      };
      emit(this.grains, GRAINS, 'grains');
      emit(this.dust, DUST, 'dust');
    });
  }
}
