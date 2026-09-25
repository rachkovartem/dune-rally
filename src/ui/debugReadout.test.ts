// src/ui/debugReadout.test.ts
import { describe, it, expect } from 'vitest';
import { formatDebugReadout, type DebugSample } from './debugReadout';

const SAMPLE: DebugSample = {
  x: 1560.04, y: 14.96, z: -3.25, headingDegrees: 359.6, cover: 'gravel', grip: 0.826, chunk: { cx: 24, cz: -1 }, serverChunks: 31,
};
const text = (sample: DebugSample): string => formatDebugReadout(sample).join('\n');

describe('formatDebugReadout — the ?debug=1 lines (S0-5)', () => {
  it('rounds the position to 0.1 m', () => {
    expect(text(SAMPLE)).toContain('x 1560.0');
    expect(text(SAMPLE)).toContain('y 15.0');
    expect(text(SAMPLE)).toContain('z -3.3');
  });

  it('shows the surface name, the grip and the chunk the car is in', () => {
    expect(text(SAMPLE)).toContain('gravel');
    expect(text(SAMPLE)).toContain('0.83');
    expect(text(SAMPLE)).toContain('24,-1');
  });

  it('shows a dash, not 0, while the server does not report its chunks', () => {
    // A 0 would read as "the server has no ground" and send a tester after a bug that is not there.
    const line = formatDebugReadout({ ...SAMPLE, serverChunks: null }).find((entry) => entry.includes('server chunks'));
    expect(line).toMatch(/server chunks —$/);
  });

  it('shows 0 server chunks as a real 0 when the server reports it', () => {
    const line = formatDebugReadout({ ...SAMPLE, serverChunks: 0 }).find((entry) => entry.includes('server chunks'));
    expect(line).toMatch(/server chunks 0$/);
  });
});
