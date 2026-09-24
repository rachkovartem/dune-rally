// src/render/devOverlay.ts
import Stats from 'three/addons/libs/stats.module.js';

export interface DevOverlay {
  update: () => void;
}

function labelElement(label: string): HTMLDivElement {
  const element = document.createElement('div');
  element.textContent = label;
  element.style.position = 'fixed';
  element.style.top = '50px';
  element.style.left = '0';
  element.style.zIndex = '30';
  element.style.padding = '2px 6px';
  element.style.background = 'rgba(0,0,0,0.6)';
  element.style.color = '#8f8';
  element.style.font = '12px monospace';
  return element;
}

export function debugModeEnabled(): boolean {
  return new URLSearchParams(location.search).get('debug') === '1';
}

/** `?debug=1` → an fps readout plus one fixed label line. Off by default. */
export function createDevOverlay(label: string): DevOverlay | null {
  if (!debugModeEnabled()) return null;

  const stats = new Stats();
  document.body.appendChild(stats.dom);
  document.body.appendChild(labelElement(label));

  return { update: () => stats.update() };
}
