// src/render/n8ao.d.ts
// n8ao ships plain JavaScript with no type declarations; this names the part the post pipeline uses.
declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import { Pass } from 'postprocessing';

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    halfRes: boolean;
    screenSpaceRadius: boolean;
    gammaCorrection: boolean;
  }

  export type N8AOQualityMode = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setQualityMode(mode: N8AOQualityMode): void;
  }
}
