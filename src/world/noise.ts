// src/world/noise.ts
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';

export type Height2D = (x: number, z: number) => number;

/**
 * Deterministic fractal height field. Output in [-10, 37] world units.
 * The prescribed octave amplitudes produce a theoretical floor of -54.5 (empirical: -37.8
 * for seed=7). A Math.max(-10, height) floor clamp enforces the documented minimum of -10
 * (task-4 Interfaces: "roughly [-8, 40]") without altering the prescribed octave or canyon
 * constants. See task-4.md Review Fix 6 for the full spec-contradiction rationale.
 */
export function createHeightField(seed: number): Height2D {
  const rng = mulberry32(seed);
  const noise = createNoise2D(rng);

  // Three octaves of fractal noise → base rolling dunes.
  const octaves = [
    { freq: 1 / 220, amp: 26 },
    { freq: 1 / 70, amp: 8 },
    { freq: 1 / 22, amp: 2.5 },
  ];

  return (x: number, z: number): number => {
    let height = 0;
    for (const { freq, amp } of octaves) {
      height += noise(x * freq, z * freq) * amp;
    }
    // Carve canyons: a separate low-frequency channel cut downward where ridged noise is high.
    const ridge = Math.abs(noise(x / 160 + 1000, z / 160 - 1000));
    height -= Math.pow(ridge, 3) * 18;
    // SPEC DEVIATION (task-4 step 3): The prescribed formula produces a theoretical floor of
    // -54.5 (octave sum ±36.5 minus canyon up to 18). The spec's own Step 1 test requires
    // toBeGreaterThanOrEqual(-10) and the Interfaces section documents the range as "[-8, 40]".
    // Empirical measurement (seed=7, 500 points): octave min -25.4, combined min -37.8 —
    // neither is close to -10 without a clamp. Reducing octave amps or the canyon multiplier
    // would equally deviate from the prescribed constants; the floor clamp is the least-invasive
    // correction that makes all prescribed values coexist.
    return Math.max(-10, height);
  };
}
