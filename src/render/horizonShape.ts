// src/render/horizonShape.ts
// The drawn shape of the border ranges. Everywhere a car can reach, the drawn ground is exactly the
// collider; the steep face above its foot gets drawn-only lumps, and past the map edge the drawn
// ground falls away, so the HDRI mountains show above the crest.
import { createNoise2D } from 'simplex-noise';
import { borderDistance, borderFaceDepth, lerp, smoothstep, SOLID_FOOT_DEPTH } from '../world/worldDef';
import { BASE_PLAIN } from '../world/mapLayout';
import { mulberry32 } from '../world/rng';

const FALL_LENGTH = 30;
/** Far enough below the lowest corner of the plain that the edge of the far layer never shows against the sky. */
const FAR_FLOOR = BASE_PLAIN.level - 50;

// Lumps on the face and the crest, so the range reads as broken rock and its skyline is not a
// smooth line. They start above the foot, where a car can no longer touch the face, and grow slowly,
// so a car that slides a few metres up the face still sits on nearly the collider shape.
const ROUGH_FROM = SOLID_FOOT_DEPTH;
const ROUGH_FULL = 12;
const ROUGH_AMPLITUDE = 2.2;
const CREST_AMPLITUDE = 4;
const CREST_FROM = 30;
const CREST_FULL = 60;
/** Raised lumps fade out over this many metres before the map edge, where the fall-away begins. */
const EDGE_FADE = 10;
const roughNoise = createNoise2D(mulberry32(0x6b0d3e));

function borderRoughness(x: number, z: number, faceDepth: number, insideEdge: number): number {
  const lumps = roughNoise(x * 0.09, z * 0.09) * 0.65 + roughNoise(x * 0.23 + 17, z * 0.23 - 5) * 0.35;
  const crest = Math.max(0, roughNoise(x * 0.025 - 40, z * 0.025 + 11)) * CREST_AMPLITUDE * smoothstep(CREST_FROM, CREST_FULL, faceDepth);
  const rough = smoothstep(ROUGH_FROM, ROUGH_FULL, faceDepth) * lumps * ROUGH_AMPLITUDE + crest;
  return rough > 0 ? rough * smoothstep(0, EDGE_FADE, insideEdge) : rough;
}

/** The drawn height for a ground point whose collider height is `height`. */
export function visualTerrainHeight(height: number, x: number, z: number): number {
  const faceDepth = borderFaceDepth(x, z);
  if (faceDepth <= ROUGH_FROM) return height;
  const insideEdge = borderDistance(x, z);
  const rough = height + borderRoughness(x, z, faceDepth, insideEdge);
  return lerp(rough, FAR_FLOOR, smoothstep(0, FALL_LENGTH, -insideEdge));
}
