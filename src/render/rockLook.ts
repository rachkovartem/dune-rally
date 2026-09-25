// src/render/rockLook.ts
// The granite look the koppies share with the boulders heaped on them: warm and grey patches, dark
// streaks down the steep faces, pale lichen on the tops. Both read the same world-space noise, so a
// boulder has the colour of the rock face behind it.
import type { LinearColor } from './farTerrain';

/** Colour multipliers on the rock scan: the warm orange-grey of the HDRI koppies and a cooler grey. */
const WARM_GRANITE = { r: 1.92, g: 1.74, b: 1.32 };
const GREY_GRANITE = { r: 1.65, g: 1.62, b: 1.52 };
/** The scan is a redder brown than the HDRI granite; this much of its colour is greyed first. */
const DESATURATE = 0.4;
/** Mean brightness the streaks, cracks and per-boulder tones leave, for the far layer's flat rock colour. */
const SHADE_MEAN = 0.88;
// Rec. 709 luma of a linear colour, the grey the desaturation moves towards.
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };
/** Share of the rock that shows the warm tone, on average over the noise. */
const WARM_SHARE = 0.6;

/** Cell size of the rounded boulders the koppie faces are drawn as, in metres: wider than tall, like the HDRI heaps. */
export const BOULDER_CELL_METRES = { across: 8, up: 5 } as const;

const glslVector = (color: { r: number; g: number; b: number }): string => `vec3(${color.r.toFixed(3)}, ${color.g.toFixed(3)}, ${color.b.toFixed(3)})`;

/** `rockLook` applied to a mean rock colour, for the far layer, which draws rock as one flat colour. */
export function rockLookMean(rock: LinearColor): LinearColor {
  const grey = rock.r * LUMA.r + rock.g * LUMA.g + rock.b * LUMA.b;
  const tone = (warm: number, cool: number): number => cool + (warm - cool) * WARM_SHARE;
  const channel = (value: number, warm: number, cool: number): number => (value + (grey - value) * DESATURATE) * tone(warm, cool) * SHADE_MEAN;
  return {
    r: channel(rock.r, WARM_GRANITE.r, GREY_GRANITE.r),
    g: channel(rock.g, WARM_GRANITE.g, GREY_GRANITE.g),
    b: channel(rock.b, WARM_GRANITE.b, GREY_GRANITE.b),
  };
}

/**
 * GLSL helpers: a hashed value noise, the boulder cells (Worley noise) and `rockLook`, which turns
 * the rock layer colour into the koppie granite at a world point.
 */
export const ROCK_LOOK_GLSL = `
float rockHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
vec3 rockHash3(vec3 p) {
  return vec3(rockHash(p), rockHash(p + 19.19), rockHash(p + 47.47));
}
float rockNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(rockHash(cell), rockHash(cell + vec3(1, 0, 0)), f.x), mix(rockHash(cell + vec3(0, 1, 0)), rockHash(cell + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(rockHash(cell + vec3(0, 0, 1)), rockHash(cell + vec3(1, 0, 1)), f.x), mix(rockHash(cell + vec3(0, 1, 1)), rockHash(cell + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// xyz: from the nearest boulder centre to p; w: distance to the next centre minus that one (0 in a
// crack). cellTone is a random number per boulder. Only the 8 cells on the near side are searched:
// a rare wrong pick shows as a small crease, which on rock reads as one more crack.
vec4 boulderCells(vec3 p, out float cellTone) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  vec3 base = step(0.5, f) - 1.0;
  float nearest = 8.0;
  float second = 8.0;
  vec3 fromCentre = vec3(0.0);
  cellTone = 0.5;
  for (int x = 0; x <= 1; x++) for (int y = 0; y <= 1; y++) for (int z = 0; z <= 1; z++) {
    vec3 offset = base + vec3(float(x), float(y), float(z));
    vec3 away = f - (offset + 0.15 + 0.7 * rockHash3(cell + offset));
    float distance = dot(away, away);
    if (distance < nearest) { second = nearest; nearest = distance; fromCentre = away; cellTone = rockHash(cell + offset + 3.7); }
    else if (distance < second) { second = distance; }
  }
  return vec4(fromCentre, sqrt(second) - sqrt(nearest));
}
vec3 rockLook(vec3 rock, vec3 world, vec3 worldNormal) {
  float patches = rockNoise(world * 0.03) * 0.6 + rockNoise(world * 0.11 + 7.0) * 0.4;
  float warm = smoothstep(${(0.5 - WARM_SHARE / 2).toFixed(2)}, ${(1.1 - WARM_SHARE / 2).toFixed(2)}, patches);
  vec3 tone = mix(${glslVector(GREY_GRANITE)}, ${glslVector(WARM_GRANITE)}, warm);
  vec3 color = mix(rock, vec3(dot(rock, vec3(${LUMA.r}, ${LUMA.g}, ${LUMA.b}))), ${DESATURATE.toFixed(2)}) * tone;
  float steep = 1.0 - abs(worldNormal.y);
  float streak = rockNoise(vec3(world.x * 0.7, world.y * 0.05, world.z * 0.7));
  color *= 1.0 - 0.45 * smoothstep(0.55, 0.85, streak) * smoothstep(0.3, 0.8, steep);
  float lichen = smoothstep(0.6, 0.78, rockNoise(world * 0.5 + 31.0)) * smoothstep(0.35, 0.85, worldNormal.y);
  return mix(color, vec3(0.42, 0.40, 0.31), lichen * 0.45);
}
`;
