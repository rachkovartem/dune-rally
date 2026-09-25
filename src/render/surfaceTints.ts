// src/render/surfaceTints.ts
// How each surface tint shades the ground on top of its texture: the numbers behind the tint ids
// the world code puts on every vertex. The near chunks, the far layer and the tyre tracks all read
// this one table, so a salt rut and the salt around it match.
import { SURFACE_TINT_IDS, type SurfaceTintId } from '../world/biome';
import type { LinearColor } from './farTerrain';

export interface SurfaceTint {
  /** Colour multiplier after the desaturation, in linear space. */
  red: number;
  green: number;
  blue: number;
  /** 0 keeps the texture's colour, 1 turns it fully grey before the multiplier. */
  desaturate: number;
  /** 0 flattens the texture's normal map, 1 keeps it. */
  normalStrength: number;
  /** Multiplies the texture's roughness; below 1 the ground reads wet. */
  roughness: number;
}

// The sand texture averages about 0.27 in linear brightness, so the salt multiplier lifts the
// greyed sand to the off-white of a real crust. A weak normal hides most sand ripples on the salt
// and some on gravel, which is compacted and graded.
const SURFACE_TINTS: Readonly<Record<SurfaceTintId, SurfaceTint>> = {
  plain: { red: 1, green: 1, blue: 1, desaturate: 0, normalStrength: 1, roughness: 1 },
  salt: { red: 2.74, green: 2.64, blue: 2.34, desaturate: 0.9, normalStrength: 0.35, roughness: 1 },
  gravel: { red: 0.86, green: 0.84, blue: 0.86, desaturate: 0.6, normalStrength: 0.6, roughness: 1 },
  dolerite: { red: 0.5, green: 0.48, blue: 0.47, desaturate: 0.55, normalStrength: 1, roughness: 1 },
  mud: { red: 0.8, green: 0.72, blue: 0.64, desaturate: 0.25, normalStrength: 0.5, roughness: 0.6 },
};

export function surfaceTintFor(id: SurfaceTintId): SurfaceTint {
  return SURFACE_TINTS[id];
}

/** The tint table in `SURFACE_TINT_IDS` order, so a tint index read from a buffer finds its tint. */
export const SURFACE_TINT_TABLE: readonly SurfaceTint[] = SURFACE_TINT_IDS.map(surfaceTintFor);

// Rec. 709 luma of a linear colour, the grey the desaturation moves towards.
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };

/** The shader's tint step on the CPU, for the far layer's vertex colours. */
export function tintColor(color: LinearColor, tint: SurfaceTint): LinearColor {
  const grey = color.r * LUMA.r + color.g * LUMA.g + color.b * LUMA.b;
  return {
    r: (color.r + (grey - color.r) * tint.desaturate) * tint.red,
    g: (color.g + (grey - color.g) * tint.desaturate) * tint.green,
    b: (color.b + (grey - color.b) * tint.desaturate) * tint.blue,
  };
}

/** GLSL twin of `tintColor`: `tint.rgb` is the multiplier and `tint.a` the desaturation. */
export const SURFACE_TINT_GLSL = `vec3 applySurfaceTint(vec3 color, vec4 tint) {
  float grey = dot(color, vec3(${LUMA.r}, ${LUMA.g}, ${LUMA.b}));
  return mix(color, vec3(grey), tint.a) * tint.rgb;
}\n`;
