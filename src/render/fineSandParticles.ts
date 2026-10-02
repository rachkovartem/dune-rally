// src/render/fineSandParticles.ts
// High-performance GPU point cloud of fine sand particles (16,000+ particles).
// Simulates loose granular sand streams, tire rooster tails, and sand splash
// when a vehicle plunges nose-down into loose sand or sand traps.
import * as THREE from 'three';
import type { Cover } from '../world/biome';
import type { LinearColor } from './farTerrain';
import type { QualityName } from './qualityTiers';

const POOL_SIZE = 16384;
const GRAVITY = 9.81;
const BOUNCE_RESTITUTION = 0.22;
const AIR_DRAG = 1.4;

const VERTEX_SHADER = /* glsl */ `
  uniform float pointScale;
  attribute vec3 color;
  attribute float scale;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = scale * (pointScale / max(0.5, -mvPosition.z));
    gl_PointSize = clamp(gl_PointSize, 1.0, 48.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distSq = dot(coord, coord);
    if (distSq > 0.25) discard;
    float normDist = sqrt(distSq) * 2.0;
    float alpha = clamp((1.0 - normDist) * 2.2, 0.0, 1.0);
    float highlight = clamp(0.75 - coord.y * 0.7 + coord.x * 0.3, 0.6, 1.4);
    gl_FragColor = vec4(vColor * highlight, alpha);
  }
`;

export interface FineSandWheel {
  contact: { x: number; y: number; z: number } | null;
  spinSpeed: number;
  lateralSlip: number;
}

export interface FineSandFrame {
  wheels: readonly FineSandWheel[];
  spinDirection: 1 | -1;
  forward: { x: number; y: number; z: number };
  left: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  cover: Cover;
  groundColor: LinearColor;
  granular: boolean;
  diveSeverity: number;
  dt: number;
}

const random = (min: number, max: number): number => min + Math.random() * (max - min);

export class FineSandParticles {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly scales: Float32Array;
  private readonly velocities: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly floor: Float32Array;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly scaleAttr: THREE.BufferAttribute;

  private live = 0;
  private emissionOwed: number[] = [];
  private rateScale = 1.0;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(POOL_SIZE * 3);
    this.colors = new Float32Array(POOL_SIZE * 3);
    this.scales = new Float32Array(POOL_SIZE);
    this.velocities = new Float32Array(POOL_SIZE * 3);
    this.age = new Float32Array(POOL_SIZE);
    this.life = new Float32Array(POOL_SIZE);
    this.floor = new Float32Array(POOL_SIZE);

    this.geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.scaleAttr = new THREE.BufferAttribute(this.scales, 1).setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setAttribute('scale', this.scaleAttr);
    this.geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        pointScale: { value: 65.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  setQuality(quality: QualityName): void {
    this.rateScale = quality === 'high' ? 1.0 : 0.5;
  }

  liveCount(): number {
    return this.live;
  }

  update(frame: FineSandFrame): void {
    if (frame.cover === 'sand' || frame.cover === 'mud') {
      this.emit(frame);
    }
    this.step(frame.dt);
  }

  private emit(frame: FineSandFrame): void {
    if (this.emissionOwed.length !== frame.wheels.length) {
      this.emissionOwed = frame.wheels.map(() => 0);
    }

    const speed = Math.hypot(frame.velocity.x, frame.velocity.y, frame.velocity.z);
    const granularMult = frame.granular ? 2.8 : 1.0;
    const baseRate = frame.granular ? 400 : 180;

    // Nose dive sand splash eruption from front wheels
    if (frame.diveSeverity > 0.05) {
      const splashCount = Math.min(250, Math.floor(frame.diveSeverity * (frame.granular ? 600 : 300)));
      for (const frontIdx of [0, 1]) {
        const contact = frame.wheels[frontIdx]?.contact;
        if (!contact) continue;
        for (let i = 0; i < splashCount; i++) {
          if (this.live >= POOL_SIZE) break;
          const spreadX = random(-1.2, 1.2);
          const spreadY = random(1.5, 4.5);
          const spreadZ = random(-0.5, 2.5);
          this.spawnGrain(
            contact.x + random(-0.25, 0.25),
            contact.y + random(0.02, 0.15),
            contact.z + random(-0.25, 0.25),
            frame.forward.x * spreadZ + frame.left.x * spreadX + frame.velocity.x * 0.4,
            spreadY + frame.velocity.y * 0.3,
            frame.forward.z * spreadZ + frame.left.z * spreadX + frame.velocity.z * 0.4,
            frame.groundColor,
            contact.y - 0.05,
            random(0.7, 1.4),
          );
        }
      }
    }

    frame.wheels.forEach((wheel, wheelIndex) => {
      const contact = wheel.contact;
      if (!contact) {
        this.emissionOwed[wheelIndex] = 0;
        return;
      }

      const spinExcess = Math.max(0, wheel.spinSpeed - 0.8);
      const slipExcess = Math.max(0, wheel.lateralSlip - 1.0);
      const rollingActivity = speed > 2.0 ? Math.min(15, speed) * 0.25 : 0;
      const activity = (spinExcess * 1.5 + slipExcess * 1.2 + rollingActivity) * granularMult;

      if (activity <= 0) return;

      const due = this.emissionOwed[wheelIndex] + activity * baseRate * this.rateScale * frame.dt;
      const toSpawn = Math.min(75, Math.floor(due));
      this.emissionOwed[wheelIndex] = due - toSpawn;

      const throwSpeed = -frame.spinDirection * wheel.spinSpeed * 0.75;
      const slideSpeed = wheel.lateralSlip * 0.6;

      for (let i = 0; i < toSpawn; i++) {
        if (this.live >= POOL_SIZE) break;
        const along = throwSpeed * random(0.5, 1.1) + (speed > 2 ? -frame.forward.z * 1.5 : 0);
        const across = slideSpeed * random(-1.0, 1.0) + random(-0.8, 0.8);
        const upLift = random(0.6, 2.8) + (wheel.spinSpeed > 3 ? wheel.spinSpeed * 0.12 : 0);

        this.spawnGrain(
          contact.x + random(-0.15, 0.15),
          contact.y + random(0.01, 0.05),
          contact.z + random(-0.15, 0.15),
          frame.forward.x * along + frame.left.x * across + frame.velocity.x * 0.5,
          frame.forward.y * along + frame.left.y * across + upLift,
          frame.forward.z * along + frame.left.z * across + frame.velocity.z * 0.5,
          frame.groundColor,
          contact.y - 0.04,
          random(0.4, 0.9),
        );
      }
    });
  }

  private spawnGrain(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    baseColor: LinearColor,
    floorY: number,
    lifeSec: number,
  ): void {
    const idx = this.live++;
    const posOffset = idx * 3;

    this.positions[posOffset] = x;
    this.positions[posOffset + 1] = y;
    this.positions[posOffset + 2] = z;

    this.velocities[posOffset] = vx;
    this.velocities[posOffset + 1] = vy;
    this.velocities[posOffset + 2] = vz;

    // Golden sand granule shade variation
    const shade = random(0.85, 1.25);
    this.colors[posOffset] = Math.min(1.0, baseColor.r * shade * 1.3);
    this.colors[posOffset + 1] = Math.min(1.0, baseColor.g * shade * 1.25);
    this.colors[posOffset + 2] = Math.min(1.0, baseColor.b * shade * 1.1);

    this.scales[idx] = random(0.8, 1.6);
    this.age[idx] = 0;
    this.life[idx] = lifeSec;
    this.floor[idx] = floorY;
  }

  private step(dt: number): void {
    const dragMult = Math.max(0, 1.0 - AIR_DRAG * dt);
    const gravityDelta = GRAVITY * dt;

    let i = 0;
    while (i < this.live) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }

      const posOffset = i * 3;
      let vx = this.velocities[posOffset] * dragMult;
      let vy = this.velocities[posOffset + 1] - gravityDelta;
      let vz = this.velocities[posOffset + 2] * dragMult;

      let px = this.positions[posOffset] + vx * dt;
      let py = this.positions[posOffset + 1] + vy * dt;
      let pz = this.positions[posOffset + 2] + vz * dt;

      const floorY = this.floor[i];
      if (py <= floorY) {
        py = floorY;
        if (Math.abs(vy) > 1.2) {
          // Bounce with sand friction
          vy = -vy * BOUNCE_RESTITUTION;
          vx *= 0.45;
          vz *= 0.45;
        } else {
          // Came to rest on ground
          this.kill(i);
          continue;
        }
      }

      this.positions[posOffset] = px;
      this.positions[posOffset + 1] = py;
      this.positions[posOffset + 2] = pz;

      this.velocities[posOffset] = vx;
      this.velocities[posOffset + 1] = vy;
      this.velocities[posOffset + 2] = vz;

      i++;
    }

    if (this.live > 0) {
      this.positionAttr.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.scaleAttr.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, this.live);
  }

  private kill(idx: number): void {
    const last = --this.live;
    if (idx === last) return;

    const srcOffset = last * 3;
    const dstOffset = idx * 3;

    this.positions[dstOffset] = this.positions[srcOffset];
    this.positions[dstOffset + 1] = this.positions[srcOffset + 1];
    this.positions[dstOffset + 2] = this.positions[srcOffset + 2];

    this.colors[dstOffset] = this.colors[srcOffset];
    this.colors[dstOffset + 1] = this.colors[srcOffset + 1];
    this.colors[dstOffset + 2] = this.colors[srcOffset + 2];

    this.velocities[dstOffset] = this.velocities[srcOffset];
    this.velocities[dstOffset + 1] = this.velocities[srcOffset + 1];
    this.velocities[dstOffset + 2] = this.velocities[srcOffset + 2];

    this.scales[idx] = this.scales[last];
    this.age[idx] = this.age[last];
    this.life[idx] = this.life[last];
    this.floor[idx] = this.floor[last];
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.geometry.dispose();
    if (this.points.material instanceof THREE.Material) {
      this.points.material.dispose();
    }
  }
}
