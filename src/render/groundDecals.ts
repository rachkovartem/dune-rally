// src/render/groundDecals.ts
// The drive prototype's tyre tracks: one ribbon per wheel, a ring buffer of quads, the rut shaded
// in the fragment shader (groove, berms, tread, sun-facing walls), faded out by distance driven.
import * as THREE from 'three';
import type { Height2D } from '../world/noise';
import { surfaceTintAt, type Biome } from '../world/biome';
import { terrainSurfaceHeight } from '../world/chunkGeometry';
import { surfaceSampleAt } from '../world/surfaceSample';
import { coverTint, TERRAIN_UV_REPEATS_PER_METRE } from './terrainMesh';
import type { TerrainTextureSet } from './terrainMaterial';
import { SURFACE_TINT_GLSL, surfaceTintFor, type SurfaceTint } from './surfaceTints';

const TRACK_SEGMENTS = 1600;
const TRACK_STEP = 0.3;
const TRACK_LIFT = 0.015;
const TRACK_FADE_START = 150;
const TRACK_FADE_END = 210;
const RIBBON_WIDTH_PER_TYRE_WIDTH = 1.5;
/** A wheel touching something higher than the ground (a ramp, a rock) leaves no rut in the sand. */
const GROUND_CONTACT_TOLERANCE = 0.35;
const NORMAL_SAMPLE = 0.3;

/** Where a wheel touches, in world space; null for a wheel in the air. */
export interface WheelContact {
  x: number;
  y: number;
  z: number;
  /** How deep the wheel sits, m; absent for a contact that carries no surface data (a plain rut). */
  sink?: number;
  /** Wheelspin of the wheel, m/s; absent like `sink`. */
  spin?: number;
}

// A sunk or spinning wheel digs a deeper rut: the groove darkens, its walls and berms stand out
// more and the rut widens. Full depth is reached at `fullSink` of sinkage or `fullSpin` of spin.
export const DEEP_RUT = {
  fullSink: 0.1,
  fullSpin: 6,
  /** A spin alone digs at most this share of the full depth; only sinkage digs to the bottom. */
  spinShare: 0.6,
  grooveDarkening: 0.45,
  wallBoost: 0.8,
  bermBoost: 0.12,
  widthGrowth: 0.3,
} as const;

/** How deep a rut looks, 0 (a plain track) .. 1, from the wheel's sinkage (m) and spin (m/s). */
export function rutDepth(sink: number, spin: number): number {
  const bySink = Math.max(0, sink) / DEEP_RUT.fullSink;
  const bySpin = (DEEP_RUT.spinShare * Math.max(0, spin)) / DEEP_RUT.fullSpin;
  return Math.min(1, Math.max(bySink, Math.min(DEEP_RUT.spinShare, bySpin)));
}

interface TrackPoint {
  x: number;
  z: number;
  leftX: number;
  leftY: number;
  leftZ: number;
  rightX: number;
  rightY: number;
  rightZ: number;
  sideX: number;
  sideZ: number;
  odometer: number;
  along: number;
  tint: number;
  surfaceTint: SurfaceTint;
  depth: number;
}

interface RibbonAttributes {
  position: THREE.BufferAttribute;
  normal: THREE.BufferAttribute;
  uv: THREE.BufferAttribute;
  color: THREE.BufferAttribute;
  aSide: THREE.BufferAttribute;
  aAcross: THREE.BufferAttribute;
  aDist: THREE.BufferAttribute;
  aAlong: THREE.BufferAttribute;
  aSurfaceTint: THREE.BufferAttribute;
  aSurfaceDetail: THREE.BufferAttribute;
  aDepth: THREE.BufferAttribute;
}

interface Ribbon {
  attributes: RibbonAttributes;
  slot: number;
  last: TrackPoint | null;
  /** The slot whose far end is `last`, so a car digging in place deepens the end of its rut; null at a new rut. */
  lastSlot: number | null;
}

/** A number as a GLSL float literal (`1` would be read as an int). */
const glslFloat = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));

function createTrackMaterial(sand: TerrainTextureSet, odometer: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: sand.color, normalMap: sand.normal, roughnessMap: sand.arm, normalScale: new THREE.Vector2(0.8, 0.8),
    metalness: 0, roughness: 1, transparent: true, depthWrite: false, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOdometer = odometer;
    shader.uniforms.uFadeStart = { value: TRACK_FADE_START };
    shader.uniforms.uFadeEnd = { value: TRACK_FADE_END };
    shader.vertexShader = 'attribute float aAcross; attribute float aDist; attribute float aAlong; attribute vec3 aSide; attribute vec4 aSurfaceTint; attribute vec2 aSurfaceDetail; attribute float aDepth;\nvarying float vAcross; varying float vDist; varying float vAlong; varying vec3 vSideView; varying vec4 vSurfaceTint; varying vec2 vSurfaceDetail; varying float vDepth;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAcross = aAcross; vDist = aDist; vAlong = aAlong; vSideView = normalize((viewMatrix * vec4(aSide, 0.0)).xyz); vSurfaceTint = aSurfaceTint; vSurfaceDetail = aSurfaceDetail; vDepth = aDepth;');
    shader.fragmentShader = 'uniform float uOdometer; uniform float uFadeStart; uniform float uFadeEnd;\nvarying float vAcross; varying float vDist; varying float vAlong; varying vec3 vSideView; varying vec4 vSurfaceTint; varying vec2 vSurfaceDetail; varying float vDepth;\n'
      + SURFACE_TINT_GLSL
      + shader.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb = applySurfaceTint(diffuseColor.rgb, vSurfaceTint);
          float trackAcross = vAcross;
          float trackGroove = smoothstep(0.1, 0.2, trackAcross) * (1.0 - smoothstep(0.8, 0.9, trackAcross));
          float trackBerm = smoothstep(0.0, 0.1, trackAcross) * (1.0 - smoothstep(0.1, 0.2, trackAcross)) + smoothstep(0.8, 0.9, trackAcross) * (1.0 - smoothstep(0.9, 1.0, trackAcross));
          float trackTread = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(vAlong * 6.2832 / 0.14 + 1.5 * abs(trackAcross - 0.5)));
          diffuseColor.rgb *= mix(1.0, (0.52 + 0.12 * trackTread) * (1.0 - ${glslFloat(DEEP_RUT.grooveDarkening)} * vDepth), trackGroove) * (1.0 + (0.12 + ${glslFloat(DEEP_RUT.bermBoost)} * vDepth) * trackBerm);
          float trackEdgeAlpha = smoothstep(0.0, 0.14, trackAcross) * (1.0 - smoothstep(0.86, 1.0, trackAcross)) * 0.92;
          diffuseColor.a *= trackEdgeAlpha * (1.0 - smoothstep(uFadeStart, uFadeEnd, uOdometer - vDist));`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.0, 0.8, trackGroove) * vSurfaceDetail.y;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mix(nonPerturbedNormal, normal, vSurfaceDetail.x));
          // aSide points to the ribbon's left edge (across = 0): groove walls face the centre and berm outsides face away, so the sun shades a rut.
          float trackWall = smoothstep(0.08, 0.13, trackAcross) * (1.0 - smoothstep(0.18, 0.24, trackAcross)) - smoothstep(0.76, 0.82, trackAcross) * (1.0 - smoothstep(0.87, 0.92, trackAcross));
          float trackOuter = -(1.0 - smoothstep(0.0, 0.1, trackAcross)) + smoothstep(0.9, 1.0, trackAcross);
          normal = normalize(normal - vSideView * (trackWall * 0.55 * (1.0 + ${glslFloat(DEEP_RUT.wallBoost)} * vDepth) + trackOuter * 0.2));`);
  };
  material.customProgramCacheKey = () => 'tyre-track-rut-surface-tint-depth';
  return material;
}

/** Four rut ribbons, one per wheel, laid only where a wheel touches the ground. */
export class TireTracks {
  private readonly ribbons: Ribbon[];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly odometer = { value: 0 };
  private lastCarX: number | null = null;
  private lastCarZ = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly heightField: Height2D,
    private readonly biome: Biome,
    sand: TerrainTextureSet,
    wheelCount: number,
  ) {
    this.material = createTrackMaterial(sand, this.odometer);
    this.ribbons = Array.from({ length: wheelCount }, () => this.createRibbon());
  }

  private createRibbon(): Ribbon {
    const vertexCount = TRACK_SEGMENTS * 4;
    const geometry = new THREE.BufferGeometry();
    const attribute = (itemSize: number): THREE.BufferAttribute =>
      new THREE.BufferAttribute(new Float32Array(vertexCount * itemSize), itemSize).setUsage(THREE.DynamicDrawUsage);
    const attributes: RibbonAttributes = {
      position: attribute(3), normal: attribute(3), uv: attribute(2), color: attribute(3),
      aSide: attribute(3), aAcross: attribute(1), aDist: attribute(1), aAlong: attribute(1),
      aSurfaceTint: attribute(4), aSurfaceDetail: attribute(2), aDepth: attribute(1),
    };
    for (const [name, value] of Object.entries(attributes)) geometry.setAttribute(name, value);
    const index = new Uint32Array(TRACK_SEGMENTS * 6);
    for (let segment = 0; segment < TRACK_SEGMENTS; segment++) {
      const base = segment * 4;
      index.set([base, base + 1, base + 2, base + 1, base + 3, base + 2], segment * 6);
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    // Unused slots stay at the origin as zero-area triangles; the fade hides old ones.
    attributes.aDist.array.fill(-1e6);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    return { attributes, slot: 0, last: null, lastSlot: null };
  }

  /** After a teleport or a reset, so no rut joins the old spot to the new one. */
  breakChains(): void {
    for (const ribbon of this.ribbons) {
      ribbon.last = null;
      ribbon.lastSlot = null;
    }
    this.lastCarX = null;
  }

  private point(x: number, z: number, sideX: number, sideZ: number, along: number, ribbonWidth: number, depth: number): TrackPoint {
    const halfWidth = (ribbonWidth * (1 + DEEP_RUT.widthGrowth * depth)) / 2;
    const leftX = x + sideX * halfWidth;
    const leftZ = z + sideZ * halfWidth;
    const rightX = x - sideX * halfWidth;
    const rightZ = z - sideZ * halfWidth;
    const surface = surfaceSampleAt(this.heightField, x, z);
    const cover = this.biome.coverAt(x, z, surface.height, surface.slope);
    return {
      x, z, leftX, leftZ, rightX, rightZ, sideX, sideZ, along,
      leftY: terrainSurfaceHeight(this.heightField, leftX, leftZ) + TRACK_LIFT,
      rightY: terrainSurfaceHeight(this.heightField, rightX, rightZ) + TRACK_LIFT,
      odometer: this.odometer.value,
      tint: coverTint(cover),
      surfaceTint: surfaceTintFor(surfaceTintAt(x, z, cover)),
      depth,
    };
  }

  private writeVertex(attributes: RibbonAttributes, vertex: number, x: number, y: number, z: number, across: number, point: TrackPoint): void {
    const height = (sampleX: number, sampleZ: number): number => terrainSurfaceHeight(this.heightField, sampleX, sampleZ);
    const normalX = height(x - NORMAL_SAMPLE, z) - height(x + NORMAL_SAMPLE, z);
    const normalZ = height(x, z - NORMAL_SAMPLE) - height(x, z + NORMAL_SAMPLE);
    const length = Math.hypot(normalX, 2 * NORMAL_SAMPLE, normalZ);
    attributes.position.setXYZ(vertex, x, y, z);
    attributes.normal.setXYZ(vertex, normalX / length, (2 * NORMAL_SAMPLE) / length, normalZ / length);
    // The terrain's own planar UV at this spot, so the sand inside the rut lines up with the sand around it.
    attributes.uv.setXY(vertex, x * TERRAIN_UV_REPEATS_PER_METRE, z * TERRAIN_UV_REPEATS_PER_METRE);
    attributes.color.setXYZ(vertex, point.tint, point.tint, point.tint);
    attributes.aSide.setXYZ(vertex, point.sideX, 0, point.sideZ);
    attributes.aAcross.setX(vertex, across);
    attributes.aDist.setX(vertex, point.odometer);
    attributes.aAlong.setX(vertex, point.along);
    const surfaceTint = point.surfaceTint;
    attributes.aSurfaceTint.setXYZW(vertex, surfaceTint.red, surfaceTint.green, surfaceTint.blue, surfaceTint.desaturate);
    attributes.aSurfaceDetail.setXY(vertex, surfaceTint.normalStrength, surfaceTint.roughness);
    attributes.aDepth.setX(vertex, point.depth);
  }

  /** A wheel that digs without moving on: the far end of its last rut quad gets the new depth. */
  private deepenRutEnd(ribbon: Ribbon, depth: number): void {
    const last = ribbon.last;
    if (!last || depth <= last.depth) return;
    last.depth = depth;
    if (ribbon.lastSlot === null) return;
    const base = ribbon.lastSlot * 4;
    const depthAttribute = ribbon.attributes.aDepth;
    depthAttribute.setX(base + 2, depth);
    depthAttribute.setX(base + 3, depth);
    depthAttribute.addUpdateRange(base + 2, 2);
    depthAttribute.needsUpdate = true;
  }

  /**
   * `contacts` holds one entry per wheel, in ribbon order; `heading` is the car's yaw, used only
   * for the first point of a new rut before it has a direction of travel.
   */
  update(contacts: readonly (WheelContact | null)[], carX: number, carZ: number, heading: number, tyreWidth: number): void {
    if (contacts.length !== this.ribbons.length) {
      throw new Error(`TireTracks.update: expected ${this.ribbons.length} wheel contacts, got ${contacts.length}`);
    }
    if (this.lastCarX !== null) this.odometer.value += Math.hypot(carX - this.lastCarX, carZ - this.lastCarZ);
    this.lastCarX = carX;
    this.lastCarZ = carZ;
    const ribbonWidth = tyreWidth * RIBBON_WIDTH_PER_TYRE_WIDTH;

    contacts.forEach((contact, wheelIndex) => {
      const ribbon = this.ribbons[wheelIndex];
      const onGround = contact !== null
        && Math.abs(contact.y - terrainSurfaceHeight(this.heightField, contact.x, contact.z)) < GROUND_CONTACT_TOLERANCE;
      if (!contact || !onGround) {
        ribbon.last = null;
        ribbon.lastSlot = null;
        return;
      }
      const depth = rutDepth(contact.sink ?? 0, contact.spin ?? 0);
      if (!ribbon.last) {
        ribbon.last = this.point(contact.x, contact.z, Math.cos(heading), -Math.sin(heading), 0, ribbonWidth, depth);
        return;
      }
      const deltaX = contact.x - ribbon.last.x;
      const deltaZ = contact.z - ribbon.last.z;
      const step = Math.hypot(deltaX, deltaZ);
      if (step < TRACK_STEP) {
        this.deepenRutEnd(ribbon, depth);
        return;
      }
      if (step > TRACK_STEP * 8) {
        ribbon.last = null;
        ribbon.lastSlot = null;
        return;
      }
      // +X of the car is its left, so the left edge is the travel direction turned a quarter to the left.
      const next = this.point(contact.x, contact.z, deltaZ / step, -deltaX / step, ribbon.last.along + step, ribbonWidth, depth);
      const previous = ribbon.last;
      const base = ribbon.slot * 4;
      const attributes = ribbon.attributes;
      this.writeVertex(attributes, base, previous.leftX, previous.leftY, previous.leftZ, 0, previous);
      this.writeVertex(attributes, base + 1, previous.rightX, previous.rightY, previous.rightZ, 1, previous);
      this.writeVertex(attributes, base + 2, next.leftX, next.leftY, next.leftZ, 0, next);
      this.writeVertex(attributes, base + 3, next.rightX, next.rightY, next.rightZ, 1, next);
      for (const attribute of Object.values(attributes)) {
        attribute.addUpdateRange(base * attribute.itemSize, 4 * attribute.itemSize);
        attribute.needsUpdate = true;
      }
      ribbon.lastSlot = ribbon.slot;
      ribbon.slot = (ribbon.slot + 1) % TRACK_SEGMENTS;
      ribbon.last = next;
    });
  }
}
