// src/world/terrain/basePlain.ts
// Layer 1 of the height: the open plain. A gentle tilt toward the pan, long low swells, and a
// fine relief kept soft enough that a car stays planted at real gravity.
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../rng';
import { BASE_PLAIN } from '../mapLayout';

const swellNoise = createNoise2D(mulberry32(0x9a1b0c01));
const microNoises = BASE_PLAIN.micro.map((layer, index) => ({
  noise: createNoise2D(mulberry32(0x5eed1234 + index)),
  frequency: 1 / layer.wavelength,
  amplitude: layer.amplitude,
}));

const SWELL_FREQUENCY = 1 / BASE_PLAIN.swell.wavelength;
const SWELL_WEIGHTS = Array.from({ length: BASE_PLAIN.swell.octaves }, (_unused, octave) => 0.5 ** octave);
const SWELL_WEIGHT_SUM = SWELL_WEIGHTS.reduce((sum, weight) => sum + weight, 0);

/** The plain without its fine relief: what the border ranges and the flats are measured from. */
export function plainHeight(x: number, z: number): number {
  let swell = 0;
  for (let octave = 0; octave < SWELL_WEIGHTS.length; octave++) {
    const frequency = SWELL_FREQUENCY * 2 ** octave;
    swell += SWELL_WEIGHTS[octave] * swellNoise(x * frequency + octave * 17.3, z * frequency - octave * 9.1);
  }
  return BASE_PLAIN.level
    + BASE_PLAIN.tiltX * (x - BASE_PLAIN.centre)
    + BASE_PLAIN.tiltZ * (z - BASE_PLAIN.centre)
    + BASE_PLAIN.swell.amplitude * (swell / SWELL_WEIGHT_SUM);
}

/** The fine relief on top of the plain, a few decimetres. */
export function microRelief(x: number, z: number): number {
  let relief = 0;
  for (const layer of microNoises) relief += layer.amplitude * layer.noise(x * layer.frequency, z * layer.frequency);
  return relief;
}
