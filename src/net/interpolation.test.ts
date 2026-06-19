// src/net/interpolation.test.ts
import { describe, it, expect } from 'vitest';
import { TransformBuffer } from './interpolation';

const snap = (t: number, x: number) => ({ t, x, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 });

describe('TransformBuffer', () => {
  it('interpolates position at the midpoint', () => {
    const b = new TransformBuffer();
    b.push(snap(0, 0));
    b.push(snap(100, 10));
    expect(b.sample(50).x).toBeCloseTo(5, 5);
  });
  it('clamps before the first and after the last snapshot', () => {
    const b = new TransformBuffer();
    b.push(snap(0, 0));
    b.push(snap(100, 10));
    expect(b.sample(-20).x).toBeCloseTo(0, 5);
    expect(b.sample(250).x).toBeCloseTo(10, 5);
  });
  it('returns the only snapshot when just one is present', () => {
    const b = new TransformBuffer();
    b.push(snap(42, 7));
    expect(b.sample(1000).x).toBeCloseTo(7, 5);
  });
});
