// src/world/tbilisi/tbilisiElevation.ts
// Heightfield shaping for the Tbilisi Europe Square district, Kura river gorge, Metekhi cliff, and highway.
import { lerp, smoothstep } from '../blend';
import { segDist, type Point2 } from '../polyline';
import {
  TBILISI_CENTER, TBILISI_RADIUS, TBILISI_ROUNDABOUT,
  TBILISI_METEKHI_CLIFF, TBILISI_KURA_LINE, TBILISI_KURA_RIVER,
  TBILISI_HIGHWAY, TBILISI_HIGHWAY_WIDTH, TBILISI_METEKHI_BRIDGE,
} from './tbilisiDef';

function distToPolyline(points: readonly Point2[], x: number, z: number): { dist: number; t: number; segIdx: number } {
  let minDist = Infinity;
  let bestT = 0;
  let bestIdx = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const s = segDist(x, z, points[i].x, points[i].z, points[i + 1].x, points[i + 1].z);
    if (s.dist < minDist) {
      minDist = s.dist;
      bestT = s.t;
      bestIdx = i;
    }
  }
  return { dist: minDist, t: bestT, segIdx: bestIdx };
}

/**
 * Modifies ground height for the Tbilisi district:
 * - Carves the deep gorge for the Kura river with steep quay walls
 * - Raises the dramatic Metekhi cliff (26.5m)
 * - Levels the Europe Square roundabout and plazas (14.5m)
 * - Grades the highway connecting Europe Square to the desert rally
 */
export function applyTbilisiHeight(baseHeight: number, x: number, z: number): number {
  const distToCenter = Math.hypot(x - TBILISI_CENTER.x, z - TBILISI_CENTER.z);

  // 1. Check connecting highway reach
  const hw = distToPolyline(TBILISI_HIGHWAY, x, z);
  const highwayReach = TBILISI_HIGHWAY_WIDTH / 2 + 8;

  if (distToCenter > TBILISI_RADIUS && hw.dist > highwayReach) {
    return baseHeight;
  }

  // Base urban terrace elevation
  let urbanHeight = 14.5;

  // 2. Kura River Canyon (глубокий каньон реки Куры)
  const river = distToPolyline(TBILISI_KURA_LINE, x, z);
  if (river.dist < TBILISI_KURA_RIVER.halfWidth + 12) {
    const halfW = TBILISI_KURA_RIVER.halfWidth;
    if (river.dist <= halfW) {
      // River channel
      const bedCenter = TBILISI_KURA_RIVER.bedElevation;
      const bedEdge = TBILISI_KURA_RIVER.waterElevation - 1.2;
      urbanHeight = lerp(bedCenter, bedEdge, river.dist / halfW);
    } else {
      // Steep quay embankment wall (from water level up to road terrace)
      const wallT = smoothstep(halfW, halfW + 6, river.dist);
      urbanHeight = lerp(TBILISI_KURA_RIVER.waterElevation, 14.2, wallT);
    }
  }

  // 3. Metekhi Cliff (Скала Метехи)
  // Steep dramatic bluff rising above the river on the south-east side
  const cliffDist = Math.hypot(x - TBILISI_METEKHI_CLIFF.center.x, z - TBILISI_METEKHI_CLIFF.center.z);
  if (cliffDist < TBILISI_METEKHI_CLIFF.radius + 15) {
    const cliffT = 1 - smoothstep(TBILISI_METEKHI_CLIFF.radius - 12, TBILISI_METEKHI_CLIFF.radius + 8, cliffDist);
    urbanHeight = Math.max(urbanHeight, lerp(urbanHeight, TBILISI_METEKHI_CLIFF.topElevation, cliffT));
  }

  // 4. Europe Square Roundabout & Center Island (Flat terrace for spawn & driving)
  const rbDist = Math.hypot(x - TBILISI_ROUNDABOUT.center.x, z - TBILISI_ROUNDABOUT.center.z);
  if (rbDist <= TBILISI_ROUNDABOUT.outerRadius) {
    urbanHeight = TBILISI_ROUNDABOUT.roadElevation;
  } else if (rbDist < TBILISI_ROUNDABOUT.outerRadius + 8) {
    const rbBlend = smoothstep(TBILISI_ROUNDABOUT.outerRadius, TBILISI_ROUNDABOUT.outerRadius + 8, rbDist);
    urbanHeight = lerp(TBILISI_ROUNDABOUT.roadElevation, urbanHeight, rbBlend);
  }

  // 5. Metekhi Bridge Road Surface Approach
  const bridgeHit = segDist(
    x, z,
    TBILISI_METEKHI_BRIDGE.start.x, TBILISI_METEKHI_BRIDGE.start.z,
    TBILISI_METEKHI_BRIDGE.end.x, TBILISI_METEKHI_BRIDGE.end.z,
  );
  if (bridgeHit.dist <= TBILISI_METEKHI_BRIDGE.width / 2) {
    // Keep approach ramps flush with deck
    if (bridgeHit.t < 0.15 || bridgeHit.t > 0.85) {
      urbanHeight = Math.max(urbanHeight, TBILISI_METEKHI_BRIDGE.deckElevation);
    }
  }

  // 6. Blend urban sector into surrounding terrain
  let result = urbanHeight;
  if (distToCenter > TBILISI_RADIUS - 30) {
    const sectorBlend = smoothstep(TBILISI_RADIUS - 30, TBILISI_RADIUS, distToCenter);
    result = lerp(urbanHeight, baseHeight, sectorBlend);
  }

  // 7. Connecting Highway grading
  if (hw.dist < highwayReach) {
    const totalSegs = TBILISI_HIGHWAY.length - 1;
    const progress = Math.min(1, Math.max(0, (hw.segIdx + hw.t) / totalSegs));
    const highwayTargetH = lerp(TBILISI_ROUNDABOUT.roadElevation, baseHeight, progress);
    const hwBlend = 1 - smoothstep(TBILISI_HIGHWAY_WIDTH / 2, highwayReach, hw.dist);
    const endFade = 1 - smoothstep(0.85, 1.0, progress);
    result = lerp(result, highwayTargetH, hwBlend * endFade);
  }

  return result;
}
