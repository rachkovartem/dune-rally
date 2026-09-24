// src/render/backend.ts

/** Requested render backend, parsed from the page URL. 'auto' lets three.js pick WebGPU when it can. */
export type BackendFlag = 'auto' | 'webgl2';

export type BackendKind = 'webgpu' | 'webgl2';

/**
 * Reads the `?backend=` query flag. Only the literal value `webgl2` (case-insensitive) forces
 * the WebGL2 fallback; anything else — missing, empty, or an unrecognized value — stays 'auto'
 * so a typo never silently locks the game onto the slower backend.
 */
export function parseBackendFlag(search: string): BackendFlag {
  const params = new URLSearchParams(search);
  const raw = params.get('backend');
  return raw !== null && raw.toLowerCase() === 'webgl2' ? 'webgl2' : 'auto';
}

/** Narrow shape a renderer must have for `backendKindOf` — enough to unit-test without a real renderer. */
export interface BackendFlagSource {
  backend: unknown;
}

function hasWebGPUBackendFlag(backend: unknown): boolean {
  return typeof backend === 'object' && backend !== null
    && 'isWebGPUBackend' in backend && backend.isWebGPUBackend === true;
}

/** Reads which backend a renderer actually ended up on, after init (three.js may fall back on its own). */
export function backendKindOf(renderer: BackendFlagSource): BackendKind {
  return hasWebGPUBackendFlag(renderer.backend) ? 'webgpu' : 'webgl2';
}
