// src/net/interpolation.ts
export interface Snapshot {
  t: number;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
}

export type Transform = Omit<Snapshot, 't'>;

const MAX_HISTORY = 30;

export class TransformBuffer {
  private snaps: Snapshot[] = [];

  push(s: Snapshot): void {
    this.snaps.push(s);
    if (this.snaps.length > MAX_HISTORY) this.snaps.shift();
  }

  sample(renderTime: number): Transform {
    const s = this.snaps;
    if (s.length === 0) {
      return { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
    }
    if (s.length === 1 || renderTime <= s[0].t) return strip(s[0]);
    const last = s[s.length - 1];
    if (renderTime >= last.t) return strip(last);

    let i = 0;
    while (i < s.length - 1 && s[i + 1].t < renderTime) i++;
    const a = s[i];
    const b = s[i + 1];
    const f = (renderTime - a.t) / (b.t - a.t);
    return {
      x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f),
      ...nlerpQuat(a, b, f),
    };
  }
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
