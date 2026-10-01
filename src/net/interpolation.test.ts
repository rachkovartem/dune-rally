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
  it('handles duplicate or out-of-order timestamps without returning NaN', () => {
    const b = new TransformBuffer();
    b.push(snap(50, 2));
    b.push(snap(50, 4));
    const sample = b.sample(50);
    expect(Number.isFinite(sample.x)).toBe(true);
    expect(sample.x).toBeGreaterThanOrEqual(2);
  });

  it('extrapolates position when maxExtrapolateMs > 0', () => {
    const b = new TransformBuffer();
    b.push(snap(0, 0));
    b.push(snap(100, 10)); // vx = 0.1 m/ms
    // at t = 150 (dt = 50ms into extrapolation, maxExtrapolateMs = 100):
    // decay = 1 - 0.5 * 50 / 100 = 0.75, travel = 50 * 0.75 = 37.5, x = 10 + 0.1 * 37.5 = 13.75
    const extrapolated = b.sample(150, 100);
    expect(extrapolated.x).toBeCloseTo(13.75, 2);
    // past maxExtrapolateMs (e.g. t = 300, clamped to dt = 100):
    // decay = 0.5, travel = 100 * 0.5 = 50, x = 10 + 0.1 * 50 = 15
    const clampedExtrapolated = b.sample(300, 100);
    expect(clampedExtrapolated.x).toBeCloseTo(15, 2);
  });

  it('smoothly interpolates through multiple points using monotone Hermite spline', () => {
    const b = new TransformBuffer();
    b.push(snap(0, 0));
    b.push(snap(100, 10));
    b.push(snap(200, 20));
    b.push(snap(300, 30));
    // Points along a constant velocity line stay exactly on the line
    expect(b.sample(150).x).toBeCloseTo(15, 3);
    expect(b.sample(250).x).toBeCloseTo(25, 3);
  });

  it('clears previous history on large teleport / respawn', () => {
    const b = new TransformBuffer();
    b.push(snap(0, 0));
    b.push(snap(100, 10));
    // Teleport to x = 500 (> 25m threshold)
    b.push(snap(200, 500));
    // Sampling at 200 immediately yields 500 without interpolating from 10
    expect(b.sample(200).x).toBeCloseTo(500, 3);
  });
});
