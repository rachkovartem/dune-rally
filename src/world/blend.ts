// src/world/blend.ts
// Small pure blends shared by the height layers, the covers and the render code.

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
