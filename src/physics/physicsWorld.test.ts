// src/physics/physicsWorld.test.ts
import { describe, it, expect } from 'vitest';
import { rapierHeights } from './physicsWorld';
import { VERTS_PER_SIDE } from '../world/heightfieldData';

describe('rapierHeights', () => {
  it('transposes row-major to column-major', () => {
    // Create a small 2x2 grid (n=2) to verify transposition.
    // Row-major: row=0,col=0 => 1; row=0,col=1 => 2; row=1,col=0 => 3; row=1,col=1 => 4
    // Column-major: col=0,row=0 => 1; col=0,row=1 => 3; col=1,row=0 => 2; col=1,row=1 => 4
    // But rapierHeights uses VERTS_PER_SIDE which is CHUNK_RES+1 = 33.
    // We'll test the full-size output is correctly transposed by checking a known index.
    const n = VERTS_PER_SIDE; // 33
    const input = new Float32Array(n * n);
    // Set a specific value at row=1, col=2 => index 1*n+2
    input[1 * n + 2] = 99;
    const out = rapierHeights(input);
    // In column-major: col=2, row=1 => index 2*n+1
    expect(out[2 * n + 1]).toBe(99);
  });

  it('produces output of same length as input', () => {
    const n = VERTS_PER_SIDE;
    const input = new Float32Array(n * n);
    const out = rapierHeights(input);
    expect(out.length).toBe(n * n);
  });

  it('identity for flat terrain (all zeros)', () => {
    const n = VERTS_PER_SIDE;
    const input = new Float32Array(n * n); // all zeros
    const out = rapierHeights(input);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe(0);
    }
  });

  it('round-trip: transposing twice returns the original', () => {
    const n = VERTS_PER_SIDE;
    const input = new Float32Array(n * n);
    for (let i = 0; i < input.length; i++) input[i] = i * 0.1;
    const transposed = rapierHeights(input);
    const restored = rapierHeights(transposed);
    for (let i = 0; i < input.length; i++) {
      expect(restored[i]).toBeCloseTo(input[i], 5);
    }
  });
});
