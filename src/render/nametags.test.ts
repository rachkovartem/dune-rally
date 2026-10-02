// src/render/nametags.test.ts
import { describe, it, expect } from 'vitest';
import { NametagSprite } from './nametags';

describe('NametagSprite — overhead player labels', () => {
  it('creates a sprite with expected initial transform and scale', () => {
    const nametag = new NametagSprite({ name: 'Alex' });
    expect(nametag.sprite).toBeDefined();
    expect(nametag.sprite.position.y).toBe(2.0);
    expect(nametag.sprite.scale.x).toBeGreaterThan(2);
    expect(nametag.sprite.visible).toBe(true);
    nametag.dispose();
  });

  it('updates opacity and visibility based on camera distance', () => {
    const nametag = new NametagSprite({ name: 'Alex' });

    nametag.updateDistance(20);
    expect(nametag.sprite.visible).toBe(true);
    expect(nametag.sprite.material.opacity).toBe(1.0);

    nametag.updateDistance(65);
    expect(nametag.sprite.visible).toBe(true);
    expect(nametag.sprite.material.opacity).toBeLessThan(1.0);
    expect(nametag.sprite.material.opacity).toBeGreaterThan(0.0);

    nametag.updateDistance(150);
    expect(nametag.sprite.visible).toBe(false);

    nametag.dispose();
  });
});
