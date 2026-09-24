// scripts/convert-forester.ts
// Converts the owner's Subaru Forester 2019 FBX into public/models/forester-2019.glb. The GLB is
// gitignored, so every fresh clone must run this once (see public/models/SOURCE.md).
// Run: npx tsx scripts/convert-forester.ts "<dir>/subaru-forester-2019.fbx"

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { Document, PropertyType, getBounds, type Material, type Node as GltfNode, type Primitive } from '@gltf-transform/core';
import { dedup, joinPrimitives, meshopt, prune, simplifyPrimitive, transformPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import {
  FORESTER_TRIANGLE_TARGETS,
  classifyForesterNode,
  foresterMaterialSlotFor,
  type ForesterDeletionReason,
  type ForesterTargetKey,
  type ForesterVector,
} from '../src/assets/foresterPartRules';
import type { CarMaterialSlot } from '../src/assets/carPartRules';
import { convertFbxToRawGlb, createNodeIo, triangleCountOf, worldMatrixOf, writeGlbWithReport } from './lib/gltfPipeline';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const OUTPUT_PATH = path.join(repoRoot, 'public', 'models', 'forester-2019.glb');

const SIMPLIFY_ERROR = 0.01;

/** Slots whose texture coordinates are kept, because the converter binds a texture to them. */
const SLOTS_WITH_UV: ReadonlySet<CarMaterialSlot> = new Set(['rubber', 'brake']);

/** Placeholder base colours only: the game builds its own material per slot at load time. */
const SLOT_BASE_COLOURS: Readonly<Record<CarMaterialSlot, [number, number, number, number]>> = {
  paint: [0.04, 0.045, 0.05, 1],
  glass: [0.05, 0.08, 0.1, 1],
  clearGlass: [0.85, 0.9, 0.95, 1],
  chrome: [0.85, 0.86, 0.88, 1],
  silver: [0.55, 0.56, 0.58, 1],
  blackTrim: [0.1, 0.1, 0.11, 1],
  rubber: [0.08, 0.08, 0.09, 1],
  rim: [0.72, 0.73, 0.75, 1],
  rimDark: [0.16, 0.17, 0.18, 1],
  brake: [0.6, 0.6, 0.6, 1],
  headlight: [0.9, 0.92, 0.94, 1],
  taillight: [0.45, 0.05, 0.04, 1],
  indicator: [0.8, 0.45, 0.06, 1],
  interior: [0.08, 0.09, 0.1, 1],
  plate: [0.9, 0.9, 0.88, 1],
};

/** Source textures that ship inside the GLB. plate.jpg and plate0.jpg carry a watermark and are never read. */
const EMBEDDED_TEXTURES: readonly { slot: CarMaterialSlot; file: string; size: number; kind: 'baseColor' | 'normal' }[] = [
  { slot: 'rubber', file: 'Tire_04_DM.jpg', size: 1024, kind: 'baseColor' },
  { slot: 'rubber', file: 'Tire_04_NM.jpg', size: 1024, kind: 'normal' },
  { slot: 'brake', file: 'Brakes_01_DM.jpg', size: 512, kind: 'baseColor' },
  { slot: 'brake', file: 'Brakes_01_NM.jpg', size: 512, kind: 'normal' },
];

interface PartGroup {
  slot: CarMaterialSlot;
  targetKey: ForesterTargetKey;
  hub: ForesterVector | null;
  nodes: GltfNode[];
}

interface DeletedRow {
  rawName: string;
  materialName: string;
  reason: ForesterDeletionReason;
}

interface GroupReportRow {
  cleanId: string;
  slot: CarMaterialSlot;
  rawNodes: number;
  before: number;
  target: number;
  after: number;
}

function onlyPrimitiveOf(node: GltfNode): Primitive {
  const mesh = node.getMesh();
  if (!mesh) throw new Error(`convert-forester: node "${node.getName()}" has no mesh`);
  const primitives = mesh.listPrimitives();
  if (primitives.length !== 1) {
    throw new Error(`convert-forester: node "${node.getName()}" has ${primitives.length} primitives, expected 1`);
  }
  return primitives[0];
}

function materialNameOf(node: GltfNode): string {
  const material = onlyPrimitiveOf(node).getMaterial();
  if (!material) throw new Error(`convert-forester: node "${node.getName()}" has no material`);
  return material.getName();
}

function worldBoundsOf(node: GltfNode): { centre: ForesterVector; size: ForesterVector } {
  const position = onlyPrimitiveOf(node).getAttribute('POSITION');
  if (!position) throw new Error(`convert-forester: node "${node.getName()}" has no POSITION`);
  const matrix = worldMatrixOf(node);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < position.getCount(); vertex++) {
    const element = position.getElement(vertex, [0, 0, 0]);
    box.expandByPoint(point.set(element[0], element[1], element[2]).applyMatrix4(matrix));
  }
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { centre: { x: centre.x, y: centre.y, z: centre.z }, size: { x: size.x, y: size.y, z: size.z } };
}

function trianglesOf(primitives: readonly Primitive[]): number {
  return primitives.reduce((sum, primitive) => sum + triangleCountOf(primitive), 0);
}

function localPositionsOf(node: GltfNode): Float32Array {
  const position = onlyPrimitiveOf(node).getAttribute('POSITION');
  if (!position) throw new Error(`convert-forester: node "${node.getName()}" has no POSITION`);
  const values = new Float32Array(position.getCount() * 3);
  for (let vertex = 0; vertex < position.getCount(); vertex++) {
    const element = position.getElement(vertex, [0, 0, 0]);
    values.set(element, vertex * 3);
  }
  return values;
}

function requireNode(nodes: ReadonlyMap<string, GltfNode>, cleanId: string): GltfNode {
  const node = nodes.get(cleanId);
  if (!node) throw new Error(`convert-forester: the converted model has no "${cleanId}" node`);
  return node;
}

/** Reads the numbers for `measuredCarForester` off the converted document, the same way as the Pajero's. */
function printMeasuredCar(doc: Document, nodes: ReadonlyMap<string, GltfNode>): void {
  const frontLeft = requireNode(nodes, 'wheelFL');
  const frontRight = requireNode(nodes, 'wheelFR');
  const rearLeft = requireNode(nodes, 'wheelRL');
  const hub = frontLeft.getTranslation();
  const wheelbase = Math.abs(hub[2] - rearLeft.getTranslation()[2]);
  const track = Math.abs(hub[0] - frontRight.getTranslation()[0]);

  // Tyre vertices are centred on the hub, so local positions give radius and width directly.
  const tyre = localPositionsOf(frontLeft);
  let tyreRadius = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let offset = 0; offset < tyre.length; offset += 3) {
    tyreRadius = Math.max(tyreRadius, Math.hypot(tyre[offset + 1], tyre[offset + 2]));
    minX = Math.min(minX, tyre[offset]);
    maxX = Math.max(maxX, tyre[offset]);
  }

  // Arch top: the lowest paint or trim point above the front hub, clearly above the hub itself.
  let archTopY = Infinity;
  for (const cleanId of ['paint', 'blackTrim']) {
    const body = localPositionsOf(requireNode(nodes, cleanId));
    for (let offset = 0; offset < body.length; offset += 3) {
      const horizontalDistance = Math.hypot(body[offset] - hub[0], body[offset + 2] - hub[2]);
      if (horizontalDistance < 0.2 && body[offset + 1] > hub[1] + tyreRadius * 0.5) {
        archTopY = Math.min(archTopY, body[offset + 1]);
      }
    }
  }

  const bounds = getBounds(doc.getRoot().listScenes()[0]);
  const rows: readonly [string, number][] = [
    ['wheelbase', wheelbase],
    ['track', track],
    ['tyreRadius', tyreRadius],
    ['tyreWidth', maxX - minX],
    ['wheelCentreY', hub[1]],
    ['archTopY', archTopY],
    ['length', bounds.max[2] - bounds.min[2]],
  ];
  console.log('Measured (from the converted GLB, metres) — copy into measuredCarForester:');
  for (const [name, value] of rows) {
    console.log(`  ${name.padEnd(13)}${Number.isFinite(value) ? value.toFixed(4) : 'not found'}`);
  }
}

async function bindTexture(doc: Document, material: Material, textureDir: string, entry: (typeof EMBEDDED_TEXTURES)[number]): Promise<void> {
  const image = await sharp(path.join(textureDir, entry.file))
    .resize(entry.size, entry.size)
    .webp({ quality: entry.kind === 'normal' ? 90 : 82 })
    .toBuffer();
  const texture = doc.createTexture(entry.file).setImage(new Uint8Array(image)).setMimeType('image/webp');
  if (entry.kind === 'normal') material.setNormalTexture(texture);
  else material.setBaseColorTexture(texture);
}

async function main(): Promise<void> {
  const fbxPath = process.argv[2];
  if (!fbxPath) {
    console.error('Usage: npx tsx scripts/convert-forester.ts "<dir>/subaru-forester-2019.fbx"');
    process.exit(1);
  }
  statSync(fbxPath); // throws loudly if the file is missing
  const textureDir = path.join(path.dirname(fbxPath), 'textures');
  for (const entry of EMBEDDED_TEXTURES) statSync(path.join(textureDir, entry.file));

  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;

  const workDir = mkdtempSync(path.join(tmpdir(), 'dune-rally-forester-'));
  const rawGlbPath = path.join(workDir, 'raw.glb');
  console.log('Converting FBX with FBX2glTF...');
  convertFbxToRawGlb(fbxPath, rawGlbPath);

  const doc = await createNodeIo().read(rawGlbPath);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];

  // 1. Classify every raw mesh node: delete it, or put it in the group of its clean id.
  const groups = new Map<string, PartGroup>();
  const deleted: DeletedRow[] = [];
  for (const node of root.listNodes()) {
    if (!node.getMesh()) continue;
    const materialName = materialNameOf(node);
    const bounds = worldBoundsOf(node);
    const decision = classifyForesterNode({ rawName: node.getName(), materialName, ...bounds });
    if (decision.kind === 'deleted') {
      deleted.push({ rawName: node.getName(), materialName, reason: decision.reason });
      node.getMesh()?.dispose();
      node.dispose();
      continue;
    }
    const group = groups.get(decision.cleanId);
    if (group) {
      group.nodes.push(node);
      continue;
    }
    groups.set(decision.cleanId, { slot: decision.slot, targetKey: decision.targetKey, hub: decision.hub, nodes: [node] });
  }

  // 2. Normals are creased at load time; UVs are kept only where a texture is bound.
  // 3. Bake each node's world matrix into its vertices; wheel parts are centred on their hub.
  for (const group of groups.values()) {
    for (const node of group.nodes) {
      const primitive = onlyPrimitiveOf(node);
      primitive.setAttribute('NORMAL', null);
      if (!SLOTS_WITH_UV.has(group.slot)) primitive.setAttribute('TEXCOORD_0', null);
      const matrix = worldMatrixOf(node);
      if (group.hub) matrix.premultiply(new THREE.Matrix4().makeTranslation(-group.hub.x, -group.hub.y, -group.hub.z));
      transformPrimitive(primitive, matrix.toArray());
    }
  }
  await doc.transform(weld());

  // 4. Simplify each group to its budget, then join it into one primitive on one clean node.
  const slotMaterials = new Map<CarMaterialSlot, Material>();
  const materialFor = (slot: CarMaterialSlot): Material => {
    const existing = slotMaterials.get(slot);
    if (existing) return existing;
    const created = doc.createMaterial(slot).setBaseColorFactor(SLOT_BASE_COLOURS[slot]).setMetallicFactor(0).setRoughnessFactor(0.6);
    slotMaterials.set(slot, created);
    return created;
  };
  const report: GroupReportRow[] = [];
  const cleanNodes = new Map<string, GltfNode>();
  for (const [cleanId, group] of groups) {
    if (foresterMaterialSlotFor(cleanId) !== group.slot) {
      throw new Error(`convert-forester: "${cleanId}" was classified as ${group.slot}, the rules say ${foresterMaterialSlotFor(cleanId)}`);
    }
    const primitives = group.nodes.map(onlyPrimitiveOf);
    const before = trianglesOf(primitives);
    const target = FORESTER_TRIANGLE_TARGETS[group.targetKey];
    const ratio = Math.min(1, target / before);
    const simplified = primitives.map((primitive) =>
      ratio < 1 ? simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR, lockBorder: false }) : primitive,
    );
    const material = materialFor(group.slot);
    for (const primitive of simplified) primitive.setMaterial(material);
    const joined = simplified.length > 1 ? joinPrimitives(simplified) : simplified[0];
    joined.setMaterial(material);
    const hub = group.hub;
    const cleanNode = doc
      .createNode(cleanId)
      .setMesh(doc.createMesh(cleanId).addPrimitive(joined))
      .setTranslation(hub ? [hub.x, hub.y, hub.z] : [0, 0, 0]);
    scene.addChild(cleanNode);
    cleanNodes.set(cleanId, cleanNode);
    for (const node of group.nodes) {
      node.getMesh()?.dispose();
      node.dispose();
    }
    report.push({ cleanId, slot: group.slot, rawNodes: group.nodes.length, before, target, after: triangleCountOf(joined) });
  }

  // 5. Tyre and brake maps, resized to WebP. The tyre normal map carries the sidewall lettering.
  for (const entry of EMBEDDED_TEXTURES) {
    const material = slotMaterials.get(entry.slot);
    if (!material) throw new Error(`convert-forester: no "${entry.slot}" part to bind ${entry.file} to`);
    await bindTexture(doc, material, textureDir, entry);
  }

  // dedup ignores names, so the identical placeholder materials would collapse into one.
  await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), prune());

  // 6. Report.
  report.sort((rowA, rowB) => rowB.after - rowA.after);
  console.log(`Deleted raw nodes (${deleted.length}):`);
  for (const row of deleted) console.log(`  ${row.rawName.padEnd(18)}${row.materialName.padEnd(12)}${row.reason}`);
  console.log('clean id            slot        raw   before   target    after');
  for (const row of report) {
    console.log(
      `${row.cleanId.padEnd(20)}${row.slot.padEnd(12)}${String(row.rawNodes).padStart(3)}${String(row.before).padStart(9)}${String(row.target).padStart(9)}${String(row.after).padStart(9)}`,
    );
  }
  const totalBefore = report.reduce((sum, row) => sum + row.before, 0);
  const totalAfter = report.reduce((sum, row) => sum + row.after, 0);
  console.log(`Total drawn triangles: ${totalAfter} (raw ${totalBefore}), ${report.length} nodes`);
  printMeasuredCar(doc, cleanNodes);

  // 7. Compress and write.
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await writeGlbWithReport(doc, OUTPUT_PATH);

  rmSync(workDir, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
