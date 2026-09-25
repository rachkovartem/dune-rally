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

// ── nearest-segment grid ────────────────────────────────────────────────────────────
interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

function pointToSegment(px: number, pz: number, segment: Segment): number {
  const dx = segment.bx - segment.ax;
  const dz = segment.bz - segment.az;
  const lengthSquared = dx * dx + dz * dz;
  let t = lengthSquared > 0 ? ((px - segment.ax) * dx + (pz - segment.az) * dz) / lengthSquared : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (segment.ax + t * dx), pz - (segment.az + t * dz));
}

function pointToBox(px: number, pz: number, box: Bounds): number {
  return Math.hypot(Math.max(box.minX - px, 0, px - box.maxX), Math.max(box.minZ - pz, 0, pz - box.maxZ));
}

// Liang–Barsky clipping: does the segment pass through the closed box?
function segmentCrossesBox(segment: Segment, box: Bounds): boolean {
  const dx = segment.bx - segment.ax;
  const dz = segment.bz - segment.az;
  let enter = 0;
  let leave = 1;
  const edges: readonly [number, number][] = [
    [-dx, segment.ax - box.minX], [dx, box.maxX - segment.ax], [-dz, segment.az - box.minZ], [dz, box.maxZ - segment.az],
  ];
  for (const [direction, room] of edges) {
    if (direction === 0) {
      if (room < 0) return false;
      continue;
    }
    const share = room / direction;
    if (direction < 0) enter = Math.max(enter, share);
    else leave = Math.min(leave, share);
    if (enter > leave) return false;
  }
  return true;
}

function segmentToBox(segment: Segment, box: Bounds): number {
  if (segmentCrossesBox(segment, box)) return 0;
  return Math.min(
    pointToBox(segment.ax, segment.az, box),
    pointToBox(segment.bx, segment.bz, box),
    pointToSegment(box.minX, box.minZ, segment),
    pointToSegment(box.maxX, box.minZ, segment),
    pointToSegment(box.minX, box.maxZ, segment),
    pointToSegment(box.maxX, box.maxZ, segment),
  );
}

// The distance to a segment is convex, so over a box it is largest at a corner.
function farthestCornerToSegment(segment: Segment, box: Bounds): number {
  return Math.max(
    pointToSegment(box.minX, box.minZ, segment),
    pointToSegment(box.maxX, box.minZ, segment),
    pointToSegment(box.minX, box.maxZ, segment),
    pointToSegment(box.maxX, box.maxZ, segment),
  );
}

export interface NearestSegmentIndex {
  /**
   * Segment indices (segment i runs from point i to point i + 1), in line order, that include the
   * nearest segment to (x, z) whenever that segment is within the index's reach. Empty where no
   * segment comes within reach of the point's cell.
   */
  query(x: number, z: number): readonly number[];
}

/**
 * A grid over a polyline where each cell keeps only the segments that can be nearest to some point
 * of the cell: a segment farther from the whole cell than another segment is from its farthest
 * corner can never win there. Exact, and a point tests a handful of segments instead of dozens.
 */
export function createNearestSegmentIndex(points: readonly { x: number; z: number }[], reach: number, cellSize: number): NearestSegmentIndex {
  if (!(cellSize > 0) || !(reach >= 0)) throw new Error(`createNearestSegmentIndex: bad cell size ${cellSize} or reach ${reach}`);
  const segments: Segment[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    segments.push({ ax: points[index].x, az: points[index].z, bx: points[index + 1].x, bz: points[index + 1].z });
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const segment of segments) {
    minX = Math.min(minX, segment.ax, segment.bx);
    minZ = Math.min(minZ, segment.az, segment.bz);
    maxX = Math.max(maxX, segment.ax, segment.bx);
    maxZ = Math.max(maxZ, segment.az, segment.bz);
  }
  if (segments.length === 0) return { query: () => NO_ITEMS };
  const firstX = Math.floor((minX - reach) / cellSize);
  const firstZ = Math.floor((minZ - reach) / cellSize);
  const width = Math.floor((maxX + reach) / cellSize) - firstX + 1;
  const depth = Math.floor((maxZ + reach) / cellSize) - firstZ + 1;
  const candidates = createFeatureIndex(segments.map((_segment, index) => index), (index) => {
    const segment = segments[index];
    return {
      minX: Math.min(segment.ax, segment.bx) - reach,
      minZ: Math.min(segment.az, segment.bz) - reach,
      maxX: Math.max(segment.ax, segment.bx) + reach,
      maxZ: Math.max(segment.az, segment.bz) + reach,
    };
  }, cellSize);
  const cells: (readonly number[])[] = [];
  for (let row = 0; row < depth; row++) {
    for (let column = 0; column < width; column++) {
      const cellX = firstX + column;
      const cellZ = firstZ + row;
      const box: Bounds = { minX: cellX * cellSize, minZ: cellZ * cellSize, maxX: (cellX + 1) * cellSize, maxZ: (cellZ + 1) * cellSize };
      const nearby = candidates.query((cellX + 0.5) * cellSize, (cellZ + 0.5) * cellSize);
      let bound = Infinity;
      for (const index of nearby) bound = Math.min(bound, farthestCornerToSegment(segments[index], box));
      const list = nearby.filter((index) => {
        const closest = segmentToBox(segments[index], box);
        return closest <= bound && closest <= reach;
      });
      cells.push(list.length > 0 ? list : NO_ITEMS);
    }
  }
  return {
    query(x: number, z: number): readonly number[] {
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error(`NearestSegmentIndex.query: point is not finite: ${x}, ${z}`);
      const column = Math.floor(x / cellSize) - firstX;
      const row = Math.floor(z / cellSize) - firstZ;
      if (column < 0 || row < 0 || column >= width || row >= depth) return NO_ITEMS;
      return cells[row * width + column];
    },
  };
}
