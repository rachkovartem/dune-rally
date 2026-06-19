import * as THREE from 'three';

/** A few-step grayscale ramp → banded toon lighting. */
export function toonGradientMap(): THREE.DataTexture {
  const steps = new Uint8Array([60, 120, 190, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const sharedGradient = toonGradientMap();

export function makeToonMaterial(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: sharedGradient });
}
