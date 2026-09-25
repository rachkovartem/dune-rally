// src/world/testing/openPlain.ts
// Test helper: is a point on the bare open plain, away from every range, landform and the areas
// the later map steps shape (river, pan, dunes, dam, dorp, quarry, roads)?
import { borderAt, borderFaceDepth } from '../terrain/border';
import { applyLandforms } from '../terrain/landforms';
import { nearestOnPolyline } from '../polyline';
import { nearestRoad } from '../worldDef';
import { DAM, DORP_YARD, GRUISGAT, SANDRIVIER, SOUTPAN, SOUTPAN_BLEND, WIT_DUINE, type Box } from '../mapLayout';

const CLEARANCE = 100;
const RIVER_SEGMENTS = SANDRIVIER.line.slice(0, -1).map((_point, segmentIndex) => segmentIndex);

const nearBox = (box: Box, x: number, z: number, margin: number): boolean =>
  x > box.minX - margin && x < box.maxX + margin && z > box.minZ - margin && z < box.maxZ + margin;

const nearPoint = (point: { x: number; z: number }, x: number, z: number, radius: number): boolean =>
  Math.hypot(x - point.x, z - point.z) < radius;

export function isOpenPlain(x: number, z: number): boolean {
  if (borderAt(x, z).surface !== null || borderFaceDepth(x, z) > -CLEARANCE) return false;
  if (applyLandforms(0, x, z).kind !== null) return false;
  const river = nearestOnPolyline(SANDRIVIER.line, RIVER_SEGMENTS, x, z);
  if (river && river.distance < CLEARANCE) return false;
  const panX = (x - SOUTPAN.x) / (SOUTPAN.radiusX + SOUTPAN_BLEND + CLEARANCE);
  const panZ = (z - SOUTPAN.z) / (SOUTPAN.radiusZ + SOUTPAN_BLEND + CLEARANCE);
  if (panX * panX + panZ * panZ < 1) return false;
  if (nearBox(WIT_DUINE.area, x, z, WIT_DUINE.feather + CLEARANCE)) return false;
  if (nearPoint(DAM.water, x, z, DAM.wall.length + CLEARANCE)) return false;
  if (nearPoint(DORP_YARD, x, z, DORP_YARD.width + CLEARANCE)) return false;
  if (nearPoint(GRUISGAT, x, z, GRUISGAT.width + CLEARANCE)) return false;
  return nearestRoad(x, z, 30) === null;
}
