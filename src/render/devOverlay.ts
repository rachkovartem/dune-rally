// src/render/devOverlay.ts
import Stats from 'three/addons/libs/stats.module.js';
import type { BackendKind } from './backend';

export interface DevOverlay {
  update: () => void;
}

function backendLabel(backendKind: BackendKind): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = `backend: ${backendKind}`;
  el.style.position = 'fixed';
  el.style.top = '50px';
  el.style.left = '0';
  el.style.zIndex = '30';
  el.style.padding = '2px 6px';
  el.style.background = 'rgba(0,0,0,0.6)';
  el.style.color = '#8f8';
  el.style.font = '12px monospace';
  return el;
}

/** `?debug=1` → an fps readout plus a fixed "backend: webgpu|webgl2" line. Off by default. */
export function createDevOverlay(backendKind: BackendKind): DevOverlay | null {
  const params = new URLSearchParams(location.search);
  if (params.get('debug') !== '1') return null;

  const stats = new Stats();
  document.body.appendChild(stats.dom);
  document.body.appendChild(backendLabel(backendKind));

  return { update: () => stats.update() };
}
