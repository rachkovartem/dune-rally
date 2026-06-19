// src/world/noise.ts
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';

export type Height2D = (x: number, z: number) => number;

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
    // SPEC DEVIATION (task-4 step 3): The prescribed formula yields a theoretical minimum of
    // -(26+8+2.5) - 18 = -54.5 world units (empirical: -37.8 for seed=7). This violates the
    // documented output contract of "roughly [-8, 40] world units" and the spec's own range-test
    // lower bound of -10. A clamp at -10 enforces the documented interface; without it, the
    // spec's range test cannot pass. Alternative fixes (reducing octave amps or canyon multiplier)
    // would equally deviate from the prescribed constants.
    return Math.max(-10, height);
  };
}
