// scripts/lib/gltfPipeline.ts
// Helpers shared by the Node conversion scripts: running FBX2glTF, reading and writing GLBs,
// and small geometry queries on a glTF document.
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { Document, NodeIO, type Node as GltfNode, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function fbx2gltfBinary(): string {
  const platformDir = process.platform === 'darwin' ? 'Darwin' : process.platform === 'linux' ? 'Linux' : 'Windows';
  const extension = process.platform === 'win32' ? '.exe' : '';
  return path.join(repoRoot, 'node_modules', 'fbx2gltf', 'bin', platformDir, `FBX2glTF${extension}`);
}

export function convertFbxToRawGlb(fbxPath: string, outputGlbPath: string): void {
  const binary = fbx2gltfBinary();
  const result = spawnSync(binary, ['--binary', '--input', fbxPath, '--output', outputGlbPath.replace(/\.glb$/, '')], {
    stdio: 'inherit',
  });
  if (result.error) {
    const rosettaHint = process.platform === 'darwin' && process.arch === 'arm64'
      ? ' FBX2glTF is an x86_64 binary — on Apple Silicon it needs Rosetta 2 (`softwareupdate --install-rosetta`).'
      : '';
    throw new Error(`gltfPipeline: could not start FBX2glTF at ${binary}: ${result.error.message}.${rosettaHint}`);
  }
  if (result.status !== 0) {
    throw new Error(`gltfPipeline: FBX2glTF exited with code ${result.status}`);
  }
}

// The meshopt decoder and encoder must be ready (`await MeshoptEncoder.ready`) before read or write.
export function createNodeIo(): NodeIO {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

export function triangleCountOf(primitive: Primitive): number {
  const indices = primitive.getIndices();
  const position = primitive.getAttribute('POSITION');
  if (!position) return 0;
  return indices ? indices.getCount() / 3 : position.getCount() / 3;
}

export function worldMatrixOf(node: GltfNode): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(node.getWorldMatrix());
}

export async function writeGlbWithReport(doc: Document, outputPath: string): Promise<void> {
  await createNodeIo().write(outputPath, doc);
  const outputSize = statSync(outputPath).size;
  console.log(`Wrote ${outputPath} (${(outputSize / 1024).toFixed(1)} KB)`);
}
