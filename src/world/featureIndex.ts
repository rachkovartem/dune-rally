// src/world/featureIndex.ts
// A flat grid of square cells over the ground plane: each item is listed in every cell its bounds
// touch, so a point only tests the few items near it instead of every item in the world.

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface FeatureIndex<T> {
  /** Items whose bounds touch the cell of (x, z), in the order they were given; empty outside the grid. */
  query(x: number, z: number): readonly T[];
}

const NO_ITEMS: readonly never[] = Object.freeze([]);

// Cells are closed squares [i × size, (i + 1) × size], so bounds that end exactly on a cell line
// are listed on both sides of it and a query on either side finds them.
const firstCell = (min: number, cellSize: number): number => Math.ceil(min / cellSize) - 1;
const lastCell = (max: number, cellSize: number): number => Math.floor(max / cellSize);

export function createFeatureIndex<T>(
  items: readonly T[],
  boundsOf: (item: T) => Bounds,
  cellSize: number,
): FeatureIndex<T> {
  if (!(cellSize > 0)) throw new Error(`createFeatureIndex: cell size must be positive, got ${cellSize}`);
  const ranges = items.map((item) => {
    const bounds = boundsOf(item);
    if (!(bounds.minX <= bounds.maxX && bounds.minZ <= bounds.maxZ)) {
      throw new Error(`createFeatureIndex: bad bounds ${JSON.stringify(bounds)}`);
    }
    return {
      item,
      fromX: firstCell(bounds.minX, cellSize),
      toX: lastCell(bounds.maxX, cellSize),
      fromZ: firstCell(bounds.minZ, cellSize),
      toZ: lastCell(bounds.maxZ, cellSize),
    };
  });
  if (ranges.length === 0) return { query: () => NO_ITEMS };

  const minCellX = Math.min(...ranges.map((range) => range.fromX));
  const maxCellX = Math.max(...ranges.map((range) => range.toX));
  const minCellZ = Math.min(...ranges.map((range) => range.fromZ));
  const maxCellZ = Math.max(...ranges.map((range) => range.toZ));
  const width = maxCellX - minCellX + 1;
  const cells: T[][] = Array.from({ length: width * (maxCellZ - minCellZ + 1) }, () => []);
  for (const range of ranges) {
    for (let cellZ = range.fromZ; cellZ <= range.toZ; cellZ++) {
      for (let cellX = range.fromX; cellX <= range.toX; cellX++) {
        cells[(cellZ - minCellZ) * width + (cellX - minCellX)].push(range.item);
      }
    }
  }

  return {
    query(x: number, z: number): readonly T[] {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error(`FeatureIndex.query: point is not finite: ${x}, ${z}`);
      const cellX = Math.floor(x / cellSize);
      const cellZ = Math.floor(z / cellSize);
      if (cellX < minCellX || cellX > maxCellX || cellZ < minCellZ || cellZ > maxCellZ) return NO_ITEMS;
      return cells[(cellZ - minCellZ) * width + (cellX - minCellX)];
    },
  };
}
