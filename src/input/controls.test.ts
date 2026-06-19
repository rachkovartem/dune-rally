// src/input/controls.test.ts
import { describe, it, expect } from 'vitest';
import { controlsFromKeys } from './controls';

describe('controlsFromKeys', () => {
  it('idles with no keys', () => {
    expect(controlsFromKeys(new Set())).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });
  it('accelerates on W / ArrowUp', () => {
    expect(controlsFromKeys(new Set(['w'])).throttle).toBe(1);
    expect(controlsFromKeys(new Set(['arrowup'])).throttle).toBe(1);
  });
  it('brakes on S / ArrowDown', () => {
    expect(controlsFromKeys(new Set(['s'])).brake).toBe(1);
  });
  it('steers left negative and right positive', () => {
    expect(controlsFromKeys(new Set(['a'])).steer).toBe(-1);
    expect(controlsFromKeys(new Set(['d'])).steer).toBe(1);
  });
  it('cancels opposite steering', () => {
    expect(controlsFromKeys(new Set(['a', 'd'])).steer).toBe(0);
  });
});
