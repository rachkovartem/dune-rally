// src/world/chunk.ts
export const CHUNK_SIZE = 64;
// 1 m grid: fine enough for wheel-sized bumps, and a heightfield collider keeps it cheap.
export const CHUNK_RES = 64;

export interface ChunkCoord {
  cx: number;
  cz: number;
}

export function worldToChunk(x: number, z: number): ChunkCoord {
  return { cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) };
}

export function chunkKey(c: ChunkCoord): string {
  return `${c.cx},${c.cz}`;
}

export function chunkOrigin(c: ChunkCoord): { x: number; z: number } {
  return { x: c.cx * CHUNK_SIZE, z: c.cz * CHUNK_SIZE };
}

export function chunksInRadius(center: ChunkCoord, radius: number): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      out.push({ cx: center.cx + dx, cz: center.cz + dz });
    }
  }
  return out;
}
