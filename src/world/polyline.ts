// src/world/polyline.ts
// Pure 2D polyline helpers on the ground plane (x, z): smoothing authored waypoints into a curve,
// and the nearest point on a line. Shared by the height layers, the covers and the server.

export interface Point2 {
  x: number;
  z: number;
}

/** Distance from (px, pz) to the segment a→b, and where the closest point lies on it (0..1). */
export function segDist(
  px: number, pz: number, ax: number, az: number, bx: number, bz: number,
): { dist: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { dist: Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t };
}

// Trace points per `spacing` of chord, so the even resample reads a curve, not its corners.
const TRACE_SAMPLES_PER_SPACING = 8;

function withoutRepeats(points: readonly Point2[]): Point2[] {
  const kept: Point2[] = [];
  for (const point of points) {
    const last = kept[kept.length - 1];
    if (!last || last.x !== point.x || last.z !== point.z) kept.push({ x: point.x, z: point.z });
  }
  return kept;
}

// Centripetal Catmull-Rom (Barry-Goldman): unlike the uniform form it never loops or makes a cusp
// when the waypoints are unevenly spaced.
function catmullRomPoint(p0: Point2, p1: Point2, p2: Point2, p3: Point2, share: number): Point2 {
  const knot = (from: Point2, to: Point2): number => Math.sqrt(Math.hypot(to.x - from.x, to.z - from.z));
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * share;
  const mix = (a: Point2, b: Point2, ta: number, tb: number): Point2 => {
    const span = tb - ta;
    return { x: ((tb - t) * a.x + (t - ta) * b.x) / span, z: ((tb - t) * a.z + (t - ta) * b.z) / span };
  };
  const a1 = mix(p0, p1, 0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, 0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

function traceCurve(points: readonly Point2[], spacing: number): Point2[] {
  const count = points.length;
  // Mirrored end points give the first and last span a natural straight start.
  const first = points[0];
  const last = points[count - 1];
  const before: Point2 = { x: 2 * first.x - points[1].x, z: 2 * first.z - points[1].z };
  const after: Point2 = { x: 2 * last.x - points[count - 2].x, z: 2 * last.z - points[count - 2].z };
  const at = (index: number): Point2 => (index < 0 ? before : index >= count ? after : points[index]);
  const traced: Point2[] = [{ x: first.x, z: first.z }];
  for (let span = 0; span < count - 1; span++) {
    const p1 = at(span);
    const p2 = at(span + 1);
    const chord = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(4, Math.ceil((chord / spacing) * TRACE_SAMPLES_PER_SPACING));
    for (let step = 1; step < steps; step++) traced.push(catmullRomPoint(at(span - 1), p1, p2, at(span + 2), step / steps));
    traced.push({ x: p2.x, z: p2.z });
  }
  return traced;
}

/**
 * A smooth curve through the waypoints (centripetal Catmull-Rom), resampled at even steps close
 * to `spacing` metres. The first and last waypoints are kept exactly; a closed loop is not joined.
 */
export function smoothPolyline(points: readonly Point2[], spacing: number): Point2[] {
  if (!(spacing > 0)) throw new Error(`smoothPolyline: spacing must be positive, got ${spacing}`);
  const kept = withoutRepeats(points);
  if (kept.length < 2) return kept;
  const traced = traceCurve(kept, spacing);
  const lengths = [0];
  for (let index = 1; index < traced.length; index++) {
    const previous = traced[index - 1];
    lengths.push(lengths[index - 1] + Math.hypot(traced[index].x - previous.x, traced[index].z - previous.z));
  }
  const total = lengths[lengths.length - 1];
  const intervals = Math.max(1, Math.round(total / spacing));
  const step = total / intervals;
  const result: Point2[] = [{ x: kept[0].x, z: kept[0].z }];
  let segment = 1;
  for (let sample = 1; sample < intervals; sample++) {
    const distance = sample * step;
    while (lengths[segment] < distance) segment++;
    const from = traced[segment - 1];
    const to = traced[segment];
    const segmentLength = lengths[segment] - lengths[segment - 1];
    const share = segmentLength > 0 ? (distance - lengths[segment - 1]) / segmentLength : 0;
    result.push({ x: from.x + (to.x - from.x) * share, z: from.z + (to.z - from.z) * share });
  }
  const end = kept[kept.length - 1];
  result.push({ x: end.x, z: end.z });
  return result;
}

export interface SegmentHit {
  distance: number;
  /** Where the closest point lies on its segment, 0 at the segment's start and 1 at its end. */
  t: number;
  /** Sign of the 2D cross product: for a segment running along +x, 1 means the point is at +z. */
  side: -1 | 1;
  /** The closest point on the line. */
  x: number;
  z: number;
  /** Segment i runs from points[i] to points[i + 1]. */
  segmentIndex: number;
}

/**
 * The closest point to (x, z) among the listed segments of a polyline, or null when the list is
 * empty. Ties keep the segment listed first, so a sorted list gives the same answer as a full scan.
 */
export function nearestOnPolyline(
  points: readonly Point2[],
  segmentIndices: readonly number[],
  x: number,
  z: number,
): SegmentHit | null {
  let best: SegmentHit | null = null;
  for (const segmentIndex of segmentIndices) {
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= points.length - 1) {
      throw new Error(`nearestOnPolyline: no segment ${segmentIndex} in a line of ${points.length} points`);
    }
    const a = points[segmentIndex];
    const b = points[segmentIndex + 1];
    const hit = segDist(x, z, a.x, a.z, b.x, b.z);
    if (best && hit.dist >= best.distance) continue;
    const cross = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    best = {
      distance: hit.dist,
      t: hit.t,
      side: cross >= 0 ? 1 : -1,
      x: a.x + (b.x - a.x) * hit.t,
      z: a.z + (b.z - a.z) * hit.t,
      segmentIndex,
    };
  }
  return best;
}
