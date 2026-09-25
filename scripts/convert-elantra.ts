// scripts/convert-elantra.ts
// Converts the owner's Elantra AD GLB into public/models/elantra-2016.glb, which is gitignored (see
// public/models/SOURCE.md). Run: npx tsx scripts/convert-elantra.ts "<dir>/elantra-2017-avante-ad.glb"

import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, PropertyType, getBounds, type Material, type Node as GltfNode, type Primitive } from '@gltf-transform/core';
import { dedup, joinPrimitives, meshopt, prune, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import {
  ELANTRA_BADGE_COMPONENTS,
  ELANTRA_COMPONENT_SLOTS,
  ELANTRA_RAW_ROLES,
  ELANTRA_TRIANGLE_TARGETS,
  classifyElantraPart,
  elantraBadgeReasonOf,
  elantraCarSpacePoint,
  elantraComponentSlotOf,
  elantraMaterialSlotFor,
  elantraPlateQuad,
  elantraRawKeyOf,
  type ElantraBodySlot,
  type ElantraDeletionReason,
  type ElantraTargetKey,
  type ElantraVector,
} from '../src/assets/elantraPartRules';
import { boxProjectedUv, connectedComponents, type TriangleSoup } from '../src/assets/meshCleanup';
import type { CarMaterialSlot } from '../src/assets/carPartRules';
import { createNodeIo, triangleCountOf, worldMatrixOf, writeGlbWithReport } from './lib/gltfPipeline';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const OUTPUT_PATH = path.join(repoRoot, 'public', 'models', 'elantra-2016.glb');

const SIMPLIFY_ERROR = 0.01;
/** About 1 mm flakes with the game's 256 px flake map: fine sparkle up close, invisible far away. */
const PAINT_UV_REPEATS_PER_METRE = 4;
/** Real Hyundai Elantra AD (2016-2018), for the scale check only. */
const REAL_WHEELBASE = 2.7;
const REAL_LENGTH = 4.57;

interface PartGroup {
  slot: CarMaterialSlot;
  targetKey: ElantraTargetKey;
  hub: ElantraVector | null;
  primitives: Primitive[];
  rawParts: number;
}

interface GroupReportRow {
  cleanId: string;
  slot: CarMaterialSlot;
  rawParts: number;
  before: number;
  target: number;
  after: number;
}

function pathFromSceneOf(node: GltfNode): string[] {
  const names: string[] = [];
  for (let current: GltfNode | null = node; current; current = current.getParentNode()) names.unshift(current.getName());
  return names;
}

/** The primitive's triangles in car space, wound counter-clockwise even under a mirroring matrix. */
function carSpaceSoupOf(node: GltfNode, primitive: Primitive): TriangleSoup {
  const position = primitive.getAttribute('POSITION');
  if (!position) throw new Error(`convert-elantra: a primitive of "${node.getName()}" has no POSITION`);
  const matrix = worldMatrixOf(node);
  const elements = matrix.elements;
  const positions = new Float32Array(position.getCount() * 3);
  const element = [0, 0, 0];
  for (let vertex = 0; vertex < position.getCount(); vertex++) {
    position.getElement(vertex, element);
    const [x, y, z] = element;
    const world = {
      x: elements[0] * x + elements[4] * y + elements[8] * z + elements[12],
      y: elements[1] * x + elements[5] * y + elements[9] * z + elements[13],
      z: elements[2] * x + elements[6] * y + elements[10] * z + elements[14],
    };
    const car = elantraCarSpacePoint(world);
    positions.set([car.x, car.y, car.z], vertex * 3);
  }

  const sourceIndices = primitive.getIndices();
  const indexCount = sourceIndices ? sourceIndices.getCount() : position.getCount();
  const indices = new Uint32Array(indexCount);
  for (let index = 0; index < indexCount; index++) indices[index] = sourceIndices ? sourceIndices.getScalar(index) : index;
  if (matrix.determinant() < 0) {
    for (let triangle = 0; triangle < indexCount / 3; triangle++) {
      const second = indices[triangle * 3 + 1];
      indices[triangle * 3 + 1] = indices[triangle * 3 + 2];
      indices[triangle * 3 + 2] = second;
    }
  }
  return { positions, indices };
}

function boundsOf(positions: Float32Array): { centre: ElantraVector; size: ElantraVector } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[offset + axis]);
      max[axis] = Math.max(max[axis], positions[offset + axis]);
    }
  }
  return {
    centre: { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 },
    size: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
  };
}

/** Drops the connected components the rules name as badges; returns the kept soup. */
function withoutBadges(
  rawKey: string,
  soup: TriangleSoup,
  hub: ElantraVector | null,
  deletedTriangles: Map<ElantraDeletionReason, number>,
): TriangleSoup {
  if (!ELANTRA_BADGE_COMPONENTS[rawKey]) return soup;
  const { components, componentOfTriangle } = connectedComponents(soup);
  const removed = new Set<number>();
  for (const component of components) {
    const box = {
      min: { x: component.min[0], y: component.min[1], z: component.min[2] },
      max: { x: component.max[0], y: component.max[1], z: component.max[2] },
    };
    const reason = elantraBadgeReasonOf(rawKey, box, hub);
    if (!reason) continue;
    removed.add(component.id);
    deletedTriangles.set(reason, (deletedTriangles.get(reason) ?? 0) + component.triangles);
  }
  if (removed.size === 0) throw new Error(`convert-elantra: the badge rule for "${rawKey}" matched nothing`);
  const kept: number[] = [];
  for (let triangle = 0; triangle < componentOfTriangle.length; triangle++) {
    if (removed.has(componentOfTriangle[triangle])) continue;
    kept.push(soup.indices[triangle * 3], soup.indices[triangle * 3 + 1], soup.indices[triangle * 3 + 2]);
  }
  return { positions: soup.positions, indices: new Uint32Array(kept) };
}

/** Splits off the connected components the rules move to another body slot. */
function splitByComponentSlot(rawKey: string, soup: TriangleSoup): { kept: TriangleSoup; moved: { slot: ElantraBodySlot; soup: TriangleSoup }[] } {
  if (!ELANTRA_COMPONENT_SLOTS[rawKey]) return { kept: soup, moved: [] };
  const { components, componentOfTriangle } = connectedComponents(soup);
  const slotOfComponent = new Map<number, ElantraBodySlot>();
  for (const component of components) {
    const box = {
      min: { x: component.min[0], y: component.min[1], z: component.min[2] },
      max: { x: component.max[0], y: component.max[1], z: component.max[2] },
    };
    const slot = elantraComponentSlotOf(rawKey, box);
    if (slot) slotOfComponent.set(component.id, slot);
  }
  if (slotOfComponent.size === 0) throw new Error(`convert-elantra: the component slot rule for "${rawKey}" matched nothing`);
  const kept: number[] = [];
  const movedIndices = new Map<ElantraBodySlot, number[]>();
  for (let triangle = 0; triangle < componentOfTriangle.length; triangle++) {
    const corners = [soup.indices[triangle * 3], soup.indices[triangle * 3 + 1], soup.indices[triangle * 3 + 2]];
    const slot = slotOfComponent.get(componentOfTriangle[triangle]);
    if (!slot) {
      kept.push(...corners);
      continue;
    }
    const list = movedIndices.get(slot) ?? [];
    list.push(...corners);
    movedIndices.set(slot, list);
  }
  return {
    kept: { positions: soup.positions, indices: new Uint32Array(kept) },
    moved: [...movedIndices].map(([slot, indices]) => ({ slot, soup: { positions: soup.positions, indices: new Uint32Array(indices) } })),
  };
}

function primitiveFromSoup(doc: Document, soup: TriangleSoup, hub: ElantraVector | null): Primitive {
  const positions = new Float32Array(soup.positions);
  if (hub) {
    for (let offset = 0; offset < positions.length; offset += 3) {
      positions[offset] -= hub.x;
      positions[offset + 1] -= hub.y;
      positions[offset + 2] -= hub.z;
    }
  }
  const buffer = doc.getRoot().listBuffers()[0];
  return doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(soup.indices)).setBuffer(buffer));
}

function soupOfPrimitive(primitive: Primitive): TriangleSoup {
  const position = primitive.getAttribute('POSITION');
  const indices = primitive.getIndices();
  if (!position || !indices) throw new Error('convert-elantra: a joined primitive is not indexed');
  const positions = new Float32Array(position.getCount() * 3);
  const element = [0, 0, 0];
  for (let vertex = 0; vertex < position.getCount(); vertex++) positions.set(position.getElement(vertex, element), vertex * 3);
  const indexArray = new Uint32Array(indices.getCount());
  for (let index = 0; index < indexArray.length; index++) indexArray[index] = indices.getScalar(index);
  return { positions, indices: indexArray };
}

function requireNode(nodes: ReadonlyMap<string, GltfNode>, cleanId: string): GltfNode {
  const node = nodes.get(cleanId);
  if (!node) throw new Error(`convert-elantra: the converted model has no "${cleanId}" node`);
  return node;
}

function localPositionsOf(node: GltfNode): Float32Array {
  const primitive = node.getMesh()?.listPrimitives()[0];
  if (!primitive) throw new Error(`convert-elantra: node "${node.getName()}" has no primitive`);
  return soupOfPrimitive(primitive).positions;
}

/** Reads `measuredCarElantra` off the converted document. Run it before meshopt, which quantises
 * the positions and moves a compensating scale onto every node. */
function printMeasuredCar(doc: Document, nodes: ReadonlyMap<string, GltfNode>): void {
  const frontLeft = requireNode(nodes, 'wheelFL');
  const frontRight = requireNode(nodes, 'wheelFR');
  const rearLeft = requireNode(nodes, 'wheelRL');
  const hub = frontLeft.getTranslation();
  const wheelbase = Math.abs(hub[2] - rearLeft.getTranslation()[2]);
  const track = Math.abs(hub[0] - frontRight.getTranslation()[0]);

  const tyre = localPositionsOf(frontLeft);
  let tyreRadius = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let offset = 0; offset < tyre.length; offset += 3) {
    tyreRadius = Math.max(tyreRadius, Math.hypot(tyre[offset + 1], tyre[offset + 2]));
    minX = Math.min(minX, tyre[offset]);
    maxX = Math.max(maxX, tyre[offset]);
  }

  // Arch top: the lowest paint point straight above the front hub. A wider window would catch the
  // arch flank, which is lower than the tyre top on this body.
  const paint = localPositionsOf(requireNode(nodes, 'paint'));
  let archTopY = Infinity;
  for (let offset = 0; offset < paint.length; offset += 3) {
    const isAboveHub = Math.abs(paint[offset] - hub[0]) < 0.1 && Math.abs(paint[offset + 2] - hub[2]) < 0.05;
    if (isAboveHub && paint[offset + 1] > hub[1] + tyreRadius * 0.5) archTopY = Math.min(archTopY, paint[offset + 1]);
  }

  // Lowest point of the body shell, for the underbody collider.
  let lowestBodyY = Infinity;
  for (const cleanId of ['paint', 'blackTrim']) {
    const positions = localPositionsOf(requireNode(nodes, cleanId));
    for (let offset = 1; offset < positions.length; offset += 3) lowestBodyY = Math.min(lowestBodyY, positions[offset]);
  }

  const bounds = getBounds(doc.getRoot().listScenes()[0]);
  const length = bounds.max[2] - bounds.min[2];
  const rows: readonly [string, number][] = [
    ['wheelbase', wheelbase],
    ['track', track],
    ['tyreRadius', tyreRadius],
    ['tyreWidth', maxX - minX],
    ['wheelCentreY', hub[1]],
    ['archTopY', archTopY],
    ['length', length],
  ];
  console.log('Measured (from the converted GLB, metres) — copy into measuredCarElantra:');
  for (const [name, value] of rows) {
    console.log(`  ${name.padEnd(13)}${Number.isFinite(value) ? value.toFixed(4) : 'not found'}`);
  }
  console.log('Other sizes (metres, not in measuredCarElantra):');
  console.log(`  height       ${(bounds.max[1] - bounds.min[1]).toFixed(4)}`);
  console.log(`  widthMirrors ${(bounds.max[0] - bounds.min[0]).toFixed(4)}`);
  console.log(`  lowestBodyY  ${lowestBodyY.toFixed(4)}`);
  console.log(`  frontHubZ    ${hub[2].toFixed(4)}   rearHubZ ${rearLeft.getTranslation()[2].toFixed(4)}`);
  console.log(
    `Scale check: wheelbase ${((wheelbase / REAL_WHEELBASE - 1) * 100).toFixed(2)} % and length ${((length / REAL_LENGTH - 1) * 100).toFixed(2)} % against the real AD (${REAL_WHEELBASE} / ${REAL_LENGTH} m)`,
  );
}

async function main(): Promise<void> {
  const sourcePath = process.argv[2];
  if (!sourcePath) {
    console.error('Usage: npx tsx scripts/convert-elantra.ts "<dir>/elantra-2017-avante-ad.glb"');
    process.exit(1);
  }
  statSync(sourcePath); // throws loudly if the file is missing

  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;

  const source = await createNodeIo().read(sourcePath);
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene();

  // 1. Classify every raw primitive in car space: delete it, or put it in the group of its clean id.
  const groups = new Map<string, PartGroup>();
  const deletedTriangles = new Map<ElantraDeletionReason, number>();
  const movedTriangles: string[] = [];
  const seenKeys = new Set<string>();
  let rawTriangles = 0;
  for (const node of source.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const primitive of mesh.listPrimitives()) {
      const rawKey = elantraRawKeyOf(pathFromSceneOf(node), primitive.getMaterial()?.getName() ?? null);
      seenKeys.add(rawKey);
      const soup = carSpaceSoupOf(node, primitive);
      rawTriangles += soup.indices.length / 3;
      const decision = classifyElantraPart({ rawKey, ...boundsOf(soup.positions) });
      if (decision.kind === 'deleted') {
        deletedTriangles.set(decision.reason, (deletedTriangles.get(decision.reason) ?? 0) + soup.indices.length / 3);
        continue;
      }
      const { kept, moved } = splitByComponentSlot(rawKey, withoutBadges(rawKey, soup, decision.hub, deletedTriangles));
      const addToGroup = (cleanId: string, slot: CarMaterialSlot, targetKey: ElantraTargetKey, hub: ElantraVector | null, part: TriangleSoup): void => {
        const group = groups.get(cleanId) ?? { slot, targetKey, hub, primitives: [], rawParts: 0 };
        group.primitives.push(primitiveFromSoup(doc, part, hub));
        group.rawParts++;
        groups.set(cleanId, group);
      };
      addToGroup(decision.cleanId, decision.slot, decision.targetKey, decision.hub, kept);
      for (const piece of moved) {
        // Body slots are their own clean ids, and a moved piece is never part of a wheel.
        addToGroup(piece.slot, piece.slot, piece.slot, null, piece.soup);
        movedTriangles.push(`${piece.soup.indices.length / 3} triangles of ${rawKey} -> ${piece.slot}`);
      }
    }
  }
  const unusedKeys = Object.keys(ELANTRA_RAW_ROLES).filter((rawKey) => !seenKeys.has(rawKey));
  if (unusedKeys.length > 0) {
    throw new Error(`convert-elantra: rules for raw keys the source does not have: ${unusedKeys.join(', ')}`);
  }

  // 2. Weld, simplify each group to its budget and join it into one primitive on one clean node.
  const slotMaterials = new Map<CarMaterialSlot, Material>();
  const materialFor = (slot: CarMaterialSlot): Material => {
    const existing = slotMaterials.get(slot);
    if (existing) return existing;
    // The game builds its own material per slot at load time; only the name matters here.
    const created = doc.createMaterial(slot);
    slotMaterials.set(slot, created);
    return created;
  };
  const report: GroupReportRow[] = [];
  const cleanNodes = new Map<string, GltfNode>();
  const addCleanNode = (cleanId: string, primitive: Primitive, hub: ElantraVector | null): void => {
    const cleanNode = doc
      .createNode(cleanId)
      .setMesh(doc.createMesh(cleanId).addPrimitive(primitive))
      .setTranslation(hub ? [hub.x, hub.y, hub.z] : [0, 0, 0]);
    scene.addChild(cleanNode);
    cleanNodes.set(cleanId, cleanNode);
  };
  for (const [cleanId, group] of groups) {
    if (elantraMaterialSlotFor(cleanId) !== group.slot) {
      throw new Error(`convert-elantra: "${cleanId}" was classified as ${group.slot}, the rules say ${elantraMaterialSlotFor(cleanId)}`);
    }
    // The source repeats a position under several indices, and weld leaves an indexed primitive alone
    // unless told to; without it the simplifier sees every face as a separate island.
    for (const primitive of group.primitives) weldPrimitive(primitive, { overwrite: true });
    const before = group.primitives.reduce((sum, primitive) => sum + triangleCountOf(primitive), 0);
    const target = ELANTRA_TRIANGLE_TARGETS[group.targetKey];
    const ratio = Math.min(1, target / before);
    const simplified = group.primitives.map((primitive) =>
      ratio < 1 ? simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR, lockBorder: false }) : primitive,
    );
    const material = materialFor(group.slot);
    for (const primitive of simplified) primitive.setMaterial(material);
    const joined = simplified.length > 1 ? joinPrimitives(simplified) : simplified[0];
    joined.setMaterial(material);
    addCleanNode(cleanId, joined, group.hub);
    report.push({ cleanId, slot: group.slot, rawParts: group.rawParts, before, target, after: triangleCountOf(joined) });
  }

  // 3. The blank rear plate (the source has none).
  const plateQuad = elantraPlateQuad();
  const plate = primitiveFromSoup(doc, plateQuad, null).setMaterial(materialFor('plate'));
  addCleanNode('plate', plate, null);
  report.push({ cleanId: 'plate', slot: 'plate', rawParts: 0, before: 0, target: ELANTRA_TRIANGLE_TARGETS.plate, after: 2 });

  // 4. Paint UV for the flake normal map, made on the final paint mesh so no later step splits it.
  const paint = requireNode(cleanNodes, 'paint').getMesh()?.listPrimitives()[0];
  if (!paint) throw new Error('convert-elantra: the paint node has no primitive');
  const paintUv = boxProjectedUv(soupOfPrimitive(paint), PAINT_UV_REPEATS_PER_METRE);
  paint.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(paintUv).setBuffer(doc.getRoot().listBuffers()[0]));

  // dedup ignores names, so the identical placeholder materials would collapse into one.
  // prune would drop the paint UV, because no texture in the file reads it.
  await doc.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
    prune({ keepAttributes: true }),
  );

  // 5. Report, measured before meshopt quantises the positions.
  report.sort((rowA, rowB) => rowB.after - rowA.after);
  console.log(`Deleted badge triangles (${[...deletedTriangles.values()].reduce((sum, count) => sum + count, 0)}):`);
  for (const [reason, count] of deletedTriangles) console.log(`  ${reason.padEnd(16)}${count}`);
  for (const line of movedTriangles) console.log(`Moved: ${line}`);
  console.log('clean id            slot        raw   before   target    after');
  for (const row of report) {
    console.log(
      `${row.cleanId.padEnd(20)}${row.slot.padEnd(12)}${String(row.rawParts).padStart(3)}${String(row.before).padStart(9)}${String(row.target).padStart(9)}${String(row.after).padStart(9)}`,
    );
  }
  const totalAfter = report.reduce((sum, row) => sum + row.after, 0);
  console.log(`Total drawn triangles: ${totalAfter} (raw ${rawTriangles}), ${report.length} nodes`);
  printMeasuredCar(doc, cleanNodes);

  // 6. Compress and write.
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await writeGlbWithReport(doc, OUTPUT_PATH);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
