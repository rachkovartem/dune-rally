// src/debug/globals.d.ts
import type { Camera, Node } from 'three/webgpu';

declare global {
  interface Window {
    __dbg?: () => unknown;
    __tp?: (x: number, z: number) => void;
    __render?: { backend: string };
  }
}

// @types/three ships CSMShadowNode but LightShadow itself predates the `shadowNode` field that
// AnalyticLightNode reads at render time (three/src/nodes/lighting/AnalyticLightNode.js). This
// augments the real declaration file so `light.shadow.shadowNode = csmShadowNode` type-checks.
declare module 'three/src/lights/LightShadow.js' {
  interface LightShadow<TCamera extends Camera = Camera> {
    shadowNode?: Node | null;
  }
}
