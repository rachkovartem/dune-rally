// src/input/controls.ts
export interface ControlState {
  throttle: number;
  brake: number;
  steer: number;
}

export function controlsFromKeys(keys: Set<string>): ControlState {
  const has = (k: string) => keys.has(k);
  const throttle = has('w') || has('arrowup') ? 1 : 0;
  const brake = has('s') || has('arrowdown') ? 1 : 0;
  const left = has('a') || has('arrowleft') ? 1 : 0;
  const right = has('d') || has('arrowright') ? 1 : 0;
  return { throttle, brake, steer: right - left };
}
