// src/render/fineSandParticles.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { FineSandParticles, type FineSandFrame } from './fineSandParticles';

describe('FineSandParticles — GPU granular sand particle system', () => {
  let scene: THREE.Scene;
  let particles: FineSandParticles;

  beforeEach(() => {
    scene = new THREE.Scene();
    particles = new FineSandParticles(scene);
  });

  const baseFrame: FineSandFrame = {
    wheels: [
      { contact: { x: 2680, y: 15, z: 1420 }, spinSpeed: 5, lateralSlip: 0 },
      { contact: { x: 2682, y: 15, z: 1420 }, spinSpeed: 5, lateralSlip: 0 },
      { contact: { x: 2680, y: 15, z: 1417 }, spinSpeed: 0, lateralSlip: 0 },
      { contact: { x: 2682, y: 15, z: 1417 }, spinSpeed: 0, lateralSlip: 0 },
    ],
    spinDirection: 1,
    forward: { x: 0, y: 0, z: 1 },
    left: { x: 1, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 10 },
    cover: 'sand',
    groundColor: { r: 0.85, g: 0.65, b: 0.35 },
    granular: false,
    diveSeverity: 0,
    dt: 0.016,
  };

  it('adds a Points object with custom ShaderMaterial to the scene', () => {
    expect(scene.children).toContain(particles.points);
    expect(particles.points).toBeInstanceOf(THREE.Points);
    expect(particles.points.material).toBeInstanceOf(THREE.ShaderMaterial);
  });

  it('starts with 0 live particles', () => {
    expect(particles.liveCount()).toBe(0);
  });

  it('emits fine grains on sand when wheels spin', () => {
    particles.update(baseFrame);
    expect(particles.liveCount()).toBeGreaterThan(0);
  });

  it('emits more particles in granular sand trap zones', () => {
    const regular = new FineSandParticles(new THREE.Scene());
    regular.update({ ...baseFrame, granular: false });
    const regularCount = regular.liveCount();

    const trap = new FineSandParticles(new THREE.Scene());
    trap.update({ ...baseFrame, granular: true });
    const trapCount = trap.liveCount();

    expect(trapCount).toBeGreaterThan(regularCount);
  });

  it('emits a splash burst when nose dive severity is positive', () => {
    const diving = new FineSandParticles(new THREE.Scene());
    diving.update({ ...baseFrame, diveSeverity: 0.5 });
    expect(diving.liveCount()).toBeGreaterThan(100);
  });

  it('does not emit particles on road', () => {
    particles.update({ ...baseFrame, cover: 'road' });
    expect(particles.liveCount()).toBe(0);
  });

  it('disposes resources and removes points from scene', () => {
    particles.dispose(scene);
    expect(scene.children).not.toContain(particles.points);
  });
});
