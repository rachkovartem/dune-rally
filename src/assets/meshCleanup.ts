// src/assets/meshCleanup.ts
// Pure triangle-mesh helpers for the car converters: connected components (to find a badge inside
// a larger raw part) and a box-projected UV set (for the paint flake map). No three.js, no DOM.

export interface TriangleSoup {
  /** x, y, z per vertex. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
}

export interface MeshComponent {
  id: number;
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
}

export interface ComponentSplit {
  components: MeshComponent[];
  /** For each triangle, the id of its component (an index into `components`). */
  componentOfTriangle: Int32Array;
}

function positionKey(positions: Float32Array, vertex: number): string {
  const offset = vertex * 3;
  return `${positions[offset]},${positions[offset + 1]},${positions[offset + 2]}`;
}

function rootOf(parents: Int32Array, start: number): number {
  let node = start;
  while (parents[node] !== node) {
    parents[node] = parents[parents[node]];
    node = parents[node];
  }
  return node;
}

/**
 * Groups triangles that touch, through a shared vertex index or through two vertices at exactly
 * the same position (a source mesh often repeats a position under different indices).
 * Components are ordered by their first triangle.
 */
export function connectedComponents(soup: TriangleSoup): ComponentSplit {
  const vertexCount = soup.positions.length / 3;
  const triangleCount = soup.indices.length / 3;

  // One representative vertex per distinct position.
  const representativeOf = new Int32Array(vertexCount);
  const firstVertexAt = new Map<string, number>();
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const key = positionKey(soup.positions, vertex);
    const first = firstVertexAt.get(key);
    if (first === undefined) {
      firstVertexAt.set(key, vertex);
      representativeOf[vertex] = vertex;
    } else {
      representativeOf[vertex] = first;
    }
  }

  const parents = new Int32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) parents[vertex] = vertex;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const first = rootOf(parents, representativeOf[soup.indices[triangle * 3]]);
    for (let corner = 1; corner < 3; corner++) {
      const other = rootOf(parents, representativeOf[soup.indices[triangle * 3 + corner]]);
      if (other !== first) parents[other] = first;
    }
  }

  const componentIdOfRoot = new Map<number, number>();
  const components: MeshComponent[] = [];
  const componentOfTriangle = new Int32Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const root = rootOf(parents, representativeOf[soup.indices[triangle * 3]]);
    let componentId = componentIdOfRoot.get(root);
    if (componentId === undefined) {
      componentId = components.length;
      componentIdOfRoot.set(root, componentId);
      components.push({ id: componentId, triangles: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    }
    const component = components[componentId];
    component.triangles++;
    componentOfTriangle[triangle] = componentId;
    for (let corner = 0; corner < 3; corner++) {
      const offset = soup.indices[triangle * 3 + corner] * 3;
      for (let axis = 0; axis < 3; axis++) {
        const value = soup.positions[offset + axis];
        if (value < component.min[axis]) component.min[axis] = value;
        if (value > component.max[axis]) component.max[axis] = value;
      }
    }
  }
  return { components, componentOfTriangle };
}

/**
 * Box-projected UV: each vertex takes the two axes across the dominant axis of its normal (the
 * area-weighted sum of its triangles' normals), times `repeatsPerMetre`. X faces map (z, y),
 * Y faces map (x, z), Z faces map (x, y).
 */
export function boxProjectedUv(soup: TriangleSoup, repeatsPerMetre: number): Float32Array {
  if (!(repeatsPerMetre > 0)) {
    throw new Error(`boxProjectedUv: repeatsPerMetre must be > 0, got ${repeatsPerMetre}`);
  }
  const vertexCount = soup.positions.length / 3;
  const normals = new Float32Array(vertexCount * 3);
  const { positions, indices } = soup;
  for (let triangle = 0; triangle < indices.length / 3; triangle++) {
    const first = indices[triangle * 3] * 3;
    const second = indices[triangle * 3 + 1] * 3;
    const third = indices[triangle * 3 + 2] * 3;
    const edgeAX = positions[second] - positions[first];
    const edgeAY = positions[second + 1] - positions[first + 1];
    const edgeAZ = positions[second + 2] - positions[first + 2];
    const edgeBX = positions[third] - positions[first];
    const edgeBY = positions[third + 1] - positions[first + 1];
    const edgeBZ = positions[third + 2] - positions[first + 2];
    // The cross product's length is twice the area, so the sum is area-weighted.
    const normalX = edgeAY * edgeBZ - edgeAZ * edgeBY;
    const normalY = edgeAZ * edgeBX - edgeAX * edgeBZ;
    const normalZ = edgeAX * edgeBY - edgeAY * edgeBX;
    for (const offset of [first, second, third]) {
      normals[offset] += normalX;
      normals[offset + 1] += normalY;
      normals[offset + 2] += normalZ;
    }
  }

  const uv = new Float32Array(vertexCount * 2);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const offset = vertex * 3;
    const absoluteX = Math.abs(normals[offset]);
    const absoluteY = Math.abs(normals[offset + 1]);
    const absoluteZ = Math.abs(normals[offset + 2]);
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    let u: number;
    let v: number;
    if (absoluteX >= absoluteY && absoluteX >= absoluteZ) {
      u = z;
      v = y;
    } else if (absoluteY >= absoluteZ) {
      u = x;
      v = z;
    } else {
      u = x;
      v = y;
    }
    uv[vertex * 2] = u * repeatsPerMetre;
    uv[vertex * 2 + 1] = v * repeatsPerMetre;
  }
  return uv;
}
