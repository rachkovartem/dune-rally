// src/net/interpolation.ts
export interface Snapshot {
  t: number;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  steer?: number;
}

export type Transform = Omit<Snapshot, 't'>;

const MAX_HISTORY = 30;
const TELEPORT_THRESHOLD_SQ = 25 * 25; // 25 meters displacement in one tick means teleport / respawn

export class TransformBuffer {
  private snaps: Snapshot[] = [];

  push(s: Snapshot): void {
    if (this.snaps.length > 0) {
      const last = this.snaps[this.snaps.length - 1];
      const distSq = (s.x - last.x) ** 2 + (s.y - last.y) ** 2 + (s.z - last.z) ** 2;
      if (distSq > TELEPORT_THRESHOLD_SQ) {
        this.snaps = [s];
        return;
      }
      if (s.t <= last.t) {
        s = { ...s, t: last.t + 0.001 };
      }
    }
    this.snaps.push(s);
    if (this.snaps.length > MAX_HISTORY) this.snaps.shift();
  }

  sample(renderTime: number, maxExtrapolateMs = 0): Transform {
    const s = this.snaps;
    if (s.length === 0) {
      return { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0 };
    }
    if (s.length === 1 || renderTime <= s[0].t) return strip(s[0]);

    const last = s[s.length - 1];
    if (renderTime >= last.t) {
      if (maxExtrapolateMs <= 0 || s.length < 2) {
        return strip(last);
      }
      const prev = s[s.length - 2];
      const segSpan = last.t - prev.t;
      if (segSpan <= 0.0001) {
        return strip(last);
      }
      const dt = Math.min(renderTime - last.t, maxExtrapolateMs);
      const vx = (last.x - prev.x) / segSpan;
      const vy = (last.y - prev.y) / segSpan;
      const vz = (last.z - prev.z) / segSpan;
      // Damped extrapolation so motion smoothly settles rather than shooting into distance
      const travel = dt * (1 - 0.5 * (dt / maxExtrapolateMs));
      return {
        x: last.x + vx * travel,
        y: last.y + vy * travel,
        z: last.z + vz * travel,
        qx: last.qx,
        qy: last.qy,
        qz: last.qz,
        qw: last.qw,
        steer: last.steer ?? 0,
      };
    }

    let i = 0;
    while (i < s.length - 1 && s[i + 1].t < renderTime) i++;
    const a = s[i];
    const b = s[i + 1];
    const prev = i > 0 ? s[i - 1] : undefined;
    const next = i + 2 < s.length ? s[i + 2] : undefined;

    const span = b.t - a.t;
    const f = span > 0 ? (renderTime - a.t) / span : 0;
    const steer = a.steer !== undefined && b.steer !== undefined
      ? a.steer + (b.steer - a.steer) * f
      : (b.steer ?? a.steer ?? 0);

    return {
      x: monotoneHermite(prev?.x, prev?.t, a.x, a.t, b.x, b.t, next?.x, next?.t, renderTime),
      y: monotoneHermite(prev?.y, prev?.t, a.y, a.t, b.y, b.t, next?.y, next?.t, renderTime),
      z: monotoneHermite(prev?.z, prev?.t, a.z, a.t, b.z, b.t, next?.z, next?.t, renderTime),
      ...nlerpQuat(a, b, f),
      steer,
    };
  }
}

function monotoneHermite(
  p0: number | undefined, t0: number | undefined,
  p1: number, t1: number,
  p2: number, t2: number,
  p3: number | undefined, t3: number | undefined,
  t: number,
): number {
  const h = t2 - t1;
  if (h <= 0.0001) return p1;
  const delta = (p2 - p1) / h;
  if (Math.abs(delta) < 1e-7) return p1;

  let v1 = delta;
  if (p0 !== undefined && t0 !== undefined && t1 > t0) {
    v1 = (p2 - p0) / (t2 - t0);
  }
  let v2 = delta;
  if (p3 !== undefined && t3 !== undefined && t3 > t2) {
    v2 = (p3 - p1) / (t3 - t1);
  }

  // Fritsch-Carlson condition to preserve monotonicity and avoid overshoot
  if (delta * v1 <= 0) v1 = 0;
  if (delta * v2 <= 0) v2 = 0;
  const alpha = v1 / delta;
  const beta = v2 / delta;
  const distSq = alpha * alpha + beta * beta;
  if (distSq > 9) {
    const factor = 3 / Math.sqrt(distSq);
    v1 = factor * alpha * delta;
    v2 = factor * beta * delta;
  }

  const f = Math.max(0, Math.min(1, (t - t1) / h));
  const f2 = f * f;
  const f3 = f2 * f;
  const h00 = 2 * f3 - 3 * f2 + 1;
  const h10 = f3 - 2 * f2 + f;
  const h01 = -2 * f3 + 3 * f2;
  const h11 = f3 - f2;

  return h00 * p1 + h10 * (h * v1) + h01 * p2 + h11 * (h * v2);
}

function strip(s: Snapshot): Transform {
  const { t: _t, ...rest } = s;
  return rest;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

function nlerpQuat(a: Snapshot, b: Snapshot, f: number) {
  // shortest-path normalised lerp
  const dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
  const s = dot < 0 ? -1 : 1;
  const qx = lerp(a.qx, b.qx * s, f);
  const qy = lerp(a.qy, b.qy * s, f);
  const qz = lerp(a.qz, b.qz * s, f);
  const qw = lerp(a.qw, b.qw * s, f);
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  return { qx: qx / len, qy: qy / len, qz: qz / len, qw: qw / len };
}

