// src/render/duelGates.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { DuelGates } from './duelGates';
import { DUEL_TRACKS } from '../../shared/duelTracks';

describe('DuelGates', () => {
  let scene: THREE.Scene;
  let gates: DuelGates;

  beforeEach(() => {
    scene = new THREE.Scene();
    gates = new DuelGates(scene, () => 10);
  });

  it('adds root group to scene upon creation', () => {
    expect(scene.children.some((c) => c.name === 'duel-gates')).toBe(true);
  });

  it('builds gates for a track and sets active checkpoint', () => {
    const track = DUEL_TRACKS[0]; // die_myl has 2 checkpoints + 1 finish = 3
    gates.buildTrack(track);

    const root = scene.children.find((c) => c.name === 'duel-gates') as THREE.Group;
    expect(root).toBeDefined();
    // 3 checkpoint groups + 1 beacon = 4 children
    expect(root.children).toHaveLength(4);

    // Update active checkpoint
    gates.updateActiveCheckpoint(1);
    // checkpoint 0 should now be hidden (past)
    expect(root.children[0].visible).toBe(false);
    expect(root.children[1].visible).toBe(true);
  });

  it('updates animation without throwing', () => {
    gates.buildTrack(DUEL_TRACKS[1]);
    expect(() => gates.update(0.016)).not.toThrow();
  });

  it('cleans up resources on clear and destroy', () => {
    gates.buildTrack(DUEL_TRACKS[0]);
    gates.clear();
    const root = scene.children.find((c) => c.name === 'duel-gates') as THREE.Group;
    expect(root.children).toHaveLength(0);

    gates.destroy();
    expect(scene.children.some((c) => c.name === 'duel-gates')).toBe(false);
  });
});
