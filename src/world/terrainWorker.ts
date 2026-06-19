// src/world/terrainWorker.ts
import { createHeightField, type Height2D } from './noise';
import { generateChunkHeights } from './heightfieldData';

interface Req { seed: number; cx: number; cz: number }

let seedCached = -1;
let height: Height2D | null = null;

self.onmessage = (e: MessageEvent<Req>) => {
  const { seed, cx, cz } = e.data;
  if (height === null || seed !== seedCached) {
    height = createHeightField(seed);
    seedCached = seed;
  }
  const heights = generateChunkHeights(height, { cx, cz });
  // Transfer the buffer to avoid a copy.
  (self as unknown as Worker).postMessage({ cx, cz, heights }, [heights.buffer]);
};
