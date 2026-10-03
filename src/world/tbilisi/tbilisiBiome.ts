// src/world/tbilisi/tbilisiBiome.ts
// Cover resolution for the Tbilisi district.
import type { Cover } from '../biome';
import { segDist, type Point2 } from '../polyline';
import {
  TBILISI_CENTER, TBILISI_RADIUS, TBILISI_ROUNDABOUT,
  TBILISI_METEKHI_CLIFF, TBILISI_KURA_LINE, TBILISI_KURA_RIVER,
  TBILISI_HIGHWAY, TBILISI_HIGHWAY_WIDTH, TBILISI_METEKHI_BRIDGE,
} from './tbilisiDef';

function distToPolyline(points: readonly Point2[], x: number, z: number): number {
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const s = segDist(x, z, points[i].x, points[i].z, points[i + 1].x, points[i + 1].z);
    if (s.dist < minDist) minDist = s.dist;
  }
  return minDist;
}

/**
 * Returns the Cover for points in the Tbilisi district, or null if outside.
 */
export function tbilisiCoverAt(x: number, z: number, _height: number, slope: number): Cover | null {
  const distToCenter = Math.hypot(x - TBILISI_CENTER.x, z - TBILISI_CENTER.z);

  // 1. Connecting Highway
  const highwayDist = distToPolyline(TBILISI_HIGHWAY, x, z);
  if (highwayDist <= TBILISI_HIGHWAY_WIDTH / 2) {
    return 'road';
  }
  if (highwayDist <= TBILISI_HIGHWAY_WIDTH / 2 + 2) {
    return 'gravel';
  }

  // Outside Tbilisi district
  if (distToCenter > TBILISI_RADIUS) return null;

  // 2. Kura River
  const riverDist = distToPolyline(TBILISI_KURA_LINE, x, z);
  if (riverDist <= TBILISI_KURA_RIVER.halfWidth) {
    return 'water';
  }
  if (riverDist <= TBILISI_KURA_RIVER.halfWidth + 6) {
    return 'rock'; // Stone embankment quays
  }

  // 3. Metekhi Bridge
  const bridgeHit = segDist(
    x, z,
    TBILISI_METEKHI_BRIDGE.start.x, TBILISI_METEKHI_BRIDGE.start.z,
    TBILISI_METEKHI_BRIDGE.end.x, TBILISI_METEKHI_BRIDGE.end.z,
  );
  if (bridgeHit.dist <= TBILISI_METEKHI_BRIDGE.width / 2) {
    return 'road';
  }

  // 4. Metekhi Cliff
  const cliffDist = Math.hypot(x - TBILISI_METEKHI_CLIFF.center.x, z - TBILISI_METEKHI_CLIFF.center.z);
  if (cliffDist <= TBILISI_METEKHI_CLIFF.radius) {
    if (slope > 0.4 || cliffDist > TBILISI_METEKHI_CLIFF.radius - 8) {
      return 'rock';
    }
    return 'gravel'; // Courtyard around Metekhi church
  }

  // 5. Europe Square Roundabout & Island
  const rbDist = Math.hypot(x - TBILISI_ROUNDABOUT.center.x, z - TBILISI_ROUNDABOUT.center.z);
  if (rbDist <= TBILISI_ROUNDABOUT.outerRadius + 3) {
    if (rbDist <= TBILISI_ROUNDABOUT.innerRadius) {
      return 'grass'; // Green park island inside roundabout
    }
    return 'road'; // Asphalt circle
  }

  // 6. Rike Park & Plaza
  if (z < TBILISI_ROUNDABOUT.center.z - 20) {
    return 'grass';
  }

  if (slope > 0.5) return 'rock';
  return 'road';
}
