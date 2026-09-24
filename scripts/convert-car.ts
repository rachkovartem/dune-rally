// scripts/convert-car.ts
// Converts the source Pajero Sport FBX into the committed public/models/pajero-sport.glb (see
// public/models/SOURCE.md for the pipeline summary and the licence reason the FBX itself is not
// committed). Run: npx tsx scripts/convert-car.ts <path-to-fbx>

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { Accessor, Document, getBounds, type Node as GltfNode, type Primitive, type Root } from '@gltf-transform/core';
import { dedup, prune, simplify, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import {
  CAR_NODE_RENAMES,
  GLASS_SPLIT_NODES,
  NODES_TO_DELETE,
  SIMPLIFY,
  classifyCarTriangle,
  classifyWheelVertex,
  materialSlotFor,
  wheelSlotFor,
} from '../src/assets/carPartRules';
import { convertFbxToRawGlb, createNodeIo, triangleCountOf, worldMatrixOf, writeGlbWithReport } from './lib/gltfPipeline';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function trianglePositions(primitive: Primitive): { get(triangle: number): [THREE.Vector3, THREE.Vector3, THREE.Vector3] } {
  const position = primitive.getAttribute('POSITION');
  if (!position) throw new Error('convert-car: primitive has no POSITION attribute');
  const indices = primitive.getIndices();
  const indexArray = indices ? indices.getArray() : null;
  const scratch: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  return {
    get(triangle: number) {
      for (let corner = 0; corner < 3; corner++) {
        const vertexIndex = indexArray ? indexArray[triangle * 3 + corner] : triangle * 3 + corner;
        const element = position.getElement(vertexIndex, [0, 0, 0]);
        scratch[corner].set(element[0], element[1], element[2]);
      }
      return scratch;
    },
  };
}

/** Splits one primitive's triangles into two groups by a per-triangle world-space test. */
function splitPrimitiveByTriangle(
  doc: Document,
  primitive: Primitive,
  worldMatrix: THREE.Matrix4,
  classify: (world: [THREE.Vector3, THREE.Vector3, THREE.Vector3]) => 'first' | 'second',
): { first: Primitive | null; second: Primitive | null } {
  const triangles = trianglePositions(primitive);
  const count = triangleCountOf(primitive);
  const firstPositions: number[] = [];
  const secondPositions: number[] = [];
  const worldTriangle: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  for (let triangle = 0; triangle < count; triangle++) {
    const local = triangles.get(triangle);
    for (let corner = 0; corner < 3; corner++) worldTriangle[corner].copy(local[corner]).applyMatrix4(worldMatrix);
    const group = classify(worldTriangle);
    const target = group === 'first' ? firstPositions : secondPositions;
    for (let corner = 0; corner < 3; corner++) target.push(local[corner].x, local[corner].y, local[corner].z);
  }

  const buildPrimitive = (positions: number[]): Primitive | null => {
    if (positions.length === 0) return null;
    const accessor = doc.createAccessor().setType(Accessor.Type.VEC3).setArray(new Float32Array(positions));
    return doc.createPrimitive().setAttribute('POSITION', accessor).setMaterial(primitive.getMaterial());
  };

  return { first: buildPrimitive(firstPositions), second: buildPrimitive(secondPositions) };
}

/** Replaces a node's mesh with a single primitive, and (if a second half exists) adds a sibling node carrying it. */
function applySplitToNode(
  doc: Document,
  node: GltfNode,
  primitive: Primitive,
  split: { first: Primitive | null; second: Primitive | null },
  secondName: string,
): void {
  const mesh = node.getMesh();
  if (!mesh) throw new Error(`convert-car: node "${node.getName()}" has no mesh to split`);
  if (split.first) {
    const firstMesh = doc.createMesh().addPrimitive(split.first);
    node.setMesh(firstMesh);
  } else {
    node.setMesh(null);
  }
  if (split.second) {
    const secondMesh = doc.createMesh().addPrimitive(split.second);
    const secondNode = doc.createNode(secondName)
      .setMesh(secondMesh)
      .setTranslation(node.getTranslation())
      .setRotation(node.getRotation())
      .setScale(node.getScale());
    const scene = doc.getRoot().listScenes()[0];
    scene.addChild(secondNode);
  }
  primitive.dispose();
  if (mesh.listPrimitives().length === 0) mesh.dispose();
}

/** Reads off the real measurements for `measuredCar` (carPartRules.ts) from the converted model. */
function printMeasuredCar(root: Root): void {
  const byName = (name: string): GltfNode | undefined => root.listNodes().find((node) => node.getName() === name);
  const front = byName('wheelFR'); // doubles as the "right" wheel for the track measurement
  const rear = byName('wheelRR');
  const left = byName('wheelFL');
  const bodyShell = byName('bodyShell');
  if (!front || !rear || !left || !bodyShell) {
    console.warn('printMeasuredCar: a required node is missing, skipping measurement');
    return;
  }
  const frontT = front.getTranslation();
  const rearT = rear.getTranslation();
  const leftT = left.getTranslation();
  const wheelbase = Math.abs(frontT[2] - rearT[2]);
  const track = Math.abs(frontT[0] - leftT[0]);
  const wheelCentreY = frontT[1];

  const wheelMesh = front.getMesh();
  const wheelWorldMatrix = worldMatrixOf(front);
  let tyreRadius = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  if (wheelMesh) {
    for (const primitive of wheelMesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const local = new THREE.Vector3();
      const world = new THREE.Vector3();
      for (let vertex = 0; vertex < position.getCount(); vertex++) {
        const element = position.getElement(vertex, [0, 0, 0]);
        local.set(element[0], element[1], element[2]);
        world.copy(local).applyMatrix4(wheelWorldMatrix);
        tyreRadius = Math.max(tyreRadius, Math.hypot(world.y - frontT[1], world.z - frontT[2]));
        minX = Math.min(minX, world.x);
        maxX = Math.max(maxX, world.x);
      }
    }
  }
  const tyreWidth = maxX - minX;

  // Arch top: the lowest bodyShell point roughly directly above the front wheel hub, clearly
  // above the hub itself — a proxy for the wheel-well ceiling height.
  const bodyMesh = bodyShell.getMesh();
  const bodyWorldMatrix = worldMatrixOf(bodyShell);
  let archTopY = Infinity;
  const horizontalRadius = 0.2;
  if (bodyMesh) {
    for (const primitive of bodyMesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const local = new THREE.Vector3();
      const world = new THREE.Vector3();
      for (let vertex = 0; vertex < position.getCount(); vertex++) {
        const element = position.getElement(vertex, [0, 0, 0]);
        local.set(element[0], element[1], element[2]);
        world.copy(local).applyMatrix4(bodyWorldMatrix);
        const horizontalDistance = Math.hypot(world.x - frontT[0], world.z - frontT[2]);
        if (horizontalDistance < horizontalRadius && world.y > frontT[1] + tyreRadius * 0.5) {
          archTopY = Math.min(archTopY, world.y);
        }
      }
    }
  }

  const carBounds = getBounds(root.listScenes()[0]);
  const length = carBounds.max[2] - carBounds.min[2];

  console.log('Measured (from the converted GLB, world units):');
  console.log(`  wheelbase    ${wheelbase.toFixed(4)}`);
  console.log(`  track        ${track.toFixed(4)}`);
  console.log(`  tyreRadius   ${tyreRadius.toFixed(4)}`);
  console.log(`  tyreWidth    ${tyreWidth.toFixed(4)}`);
  console.log(`  wheelCentreY ${wheelCentreY.toFixed(4)}`);
  console.log(`  archTopY     ${Number.isFinite(archTopY) ? archTopY.toFixed(4) : 'not found'}`);
  console.log(`  length       ${length.toFixed(4)}`);
}

async function main(): Promise<void> {
  const fbxPath = process.argv[2];
  if (!fbxPath) {
    console.error('Usage: npx tsx scripts/convert-car.ts <path-to-fbx>');
    process.exit(1);
  }
  statSync(fbxPath); // throws loudly if the file is missing

  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;

  const workDir = mkdtempSync(path.join(tmpdir(), 'dune-rally-car-'));
  const rawGlbPath = path.join(workDir, 'raw.glb');
  console.log('Converting FBX with FBX2glTF...');
  convertFbxToRawGlb(fbxPath, rawGlbPath);

  const doc = await createNodeIo().read(rawGlbPath);
  const root = doc.getRoot();

  // 1. Drop the camera rig and the manufacturer badge (spec: unbranded).
  for (const node of root.listNodes()) {
    if (NODES_TO_DELETE.some((deletedName) => deletedName === node.getName())) node.dispose();
  }

  // 2. Untextured clay: drop per-face normals/UVs so weld can merge shared vertices.
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitive.setAttribute('NORMAL', null);
      primitive.setAttribute('TEXCOORD_0', null);
    }
  }
  // This installed gltf-transform (4.5.0) welds bitwise-identical vertices only (no tolerance
  // option) — sufficient here, since dropping NORMAL/TEXCOORD above is exactly what made the
  // raw export's duplicated-position vertices bitwise identical in the first place.
  await doc.transform(weld());

  // 3. Rename every node to its clean id. Wheels are matched by translation, not by name — the
  // exporter's Rim/.001/.002/.003 order does not correspond to FL/FR/RL/RR.
  for (const node of root.listNodes()) {
    if (!node.getMesh()) continue;
    const rawName = node.getName();
    if (rawName === 'Rim' || /^Rim\.\d+$/.test(rawName)) {
      const translation = node.getTranslation();
      const slot = wheelSlotFor({ x: translation[0], z: translation[2] });
      node.setName(slot);
      continue;
    }
    const cleanName = CAR_NODE_RENAMES[rawName];
    if (!cleanName) throw new Error(`convert-car: no rename rule for raw node "${rawName}" — add it to CAR_NODE_RENAMES`);
    node.setName(cleanName);
  }

  // 4. Simplify while every part is still whole (see SIMPLIFY's doc comment in carPartRules.ts).
  // Splitting glass/rim out first would simplify each smaller fragment on its own and inflate the
  // final triangle count, so this runs before the two splits below.
  const wheelSlots = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY.wheelRatio, error: SIMPLIFY.error }));
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY.bodyRatio, error: SIMPLIFY.error }));

  // 5. Split the body-shell/door/tailgate glass out of the paint mesh.
  for (const node of root.listNodes()) {
    const name = node.getName();
    if (!GLASS_SPLIT_NODES.some((glassNodeName) => glassNodeName === name)) continue;
    const mesh = node.getMesh();
    if (!mesh) continue;
    const worldMatrix = worldMatrixOf(node);
    for (const primitive of mesh.listPrimitives()) {
      const split = splitPrimitiveByTriangle(doc, primitive, worldMatrix, (world) => {
        const centroidY = (world[0].y + world[1].y + world[2].y) / 3;
        const centroidZ = (world[0].z + world[1].z + world[2].z) / 3;
        const edge1 = new THREE.Vector3().subVectors(world[1], world[0]);
        const edge2 = new THREE.Vector3().subVectors(world[2], world[0]);
        const normalY = new THREE.Vector3().crossVectors(edge1, edge2).normalize().y;
        const kind = classifyCarTriangle({ centroidY, centroidZ, normalY });
        return kind === 'paint' ? 'first' : 'second';
      });
      applySplitToNode(doc, node, primitive, split, `${name}Glass`);
    }
  }

  // 6. Split each wheel mesh into a rim primitive and a rubber (tyre) primitive by radial
  // distance from the hub, evaluated at the triangle centroid (a clean circular boundary, no
  // triangle needs to be subdivided).
  for (const node of root.listNodes()) {
    const name = node.getName();
    if (!wheelSlots.includes(name)) continue;
    const mesh = node.getMesh();
    if (!mesh) continue;
    const worldMatrix = worldMatrixOf(node);
    const hub = new THREE.Vector3(...node.getTranslation());
    // Measure this wheel's own tyre radius from its world-space bounds (Y/Z span, since the
    // spin axis is world X) rather than trusting a copied constant.
    let maxRadius = 0;
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const local = new THREE.Vector3();
      const world = new THREE.Vector3();
      for (let vertex = 0; vertex < position.getCount(); vertex++) {
        const element = position.getElement(vertex, [0, 0, 0]);
        local.set(element[0], element[1], element[2]);
        world.copy(local).applyMatrix4(worldMatrix);
        maxRadius = Math.max(maxRadius, Math.hypot(world.y - hub.y, world.z - hub.z));
      }
    }

    for (const primitive of mesh.listPrimitives()) {
      const split = splitPrimitiveByTriangle(doc, primitive, worldMatrix, (world) => {
        const centroidWorld = new THREE.Vector3(
          (world[0].x + world[1].x + world[2].x) / 3,
          (world[0].y + world[1].y + world[2].y) / 3,
          (world[0].z + world[1].z + world[2].z) / 3,
        );
        const radialDistance = Math.hypot(centroidWorld.y - hub.y, centroidWorld.z - hub.z);
        const kind = classifyWheelVertex(radialDistance, maxRadius);
        return kind === 'rubber' ? 'first' : 'second';
      });
      applySplitToNode(doc, node, primitive, split, `${name}Rim`);
    }
  }

  // 7. Sanity check: every node this pipeline produced must have a documented material slot.
  for (const node of root.listNodes()) {
    if (!node.getMesh()) continue;
    materialSlotFor(node.getName()); // throws on an unrecognised id
  }

  // The split primitives above are de-indexed (built one triangle at a time); weld gives them
  // an index buffer back before dedup/prune/meshopt run over the whole document.
  await doc.transform(weld());

  await doc.transform(dedup(), prune());

  // 8. Report per-node triangle counts before compression.
  const countTris = (node: GltfNode): number => {
    const mesh = node.getMesh();
    if (!mesh) return 0;
    return mesh.listPrimitives().reduce((sum, primitive) => sum + triangleCountOf(primitive), 0);
  };
  const rows = root.listNodes().filter((node) => node.getMesh()).map((node) => [node.getName(), Math.round(countTris(node))] as const);
  rows.sort((rowA, rowB) => rowB[1] - rowA[1]);
  console.log('Per-node triangle counts:');
  for (const [name, tris] of rows) console.log(`  ${name.padEnd(16)} ${tris}`);
  const totalTris = rows.reduce((sum, [, tris]) => sum + tris, 0);
  console.log(`Total drawn triangles: ${totalTris}`);

  // 9. Print the real measurements for src/assets/carPartRules.ts's `measuredCar` — read off the
  // actual converted GLB rather than copied from the feasibility probe.
  printMeasuredCar(root);

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  const outputPath = path.join(repoRoot, 'public', 'models', 'pajero-sport.glb');
  await writeGlbWithReport(doc, outputPath);

  rmSync(workDir, { recursive: true, force: true });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
