// scripts/fetch-textures.ts
// Downloads every set in src/assets/textureManifest.ts from ambientCG and packs it into three
// 1024x1024 WebP maps (color/normal/arm) plus public/textures/LICENSES.md. Downloads cache in
// .cache/textures/ (gitignored). Run: npx tsx scripts/fetch-textures.ts

import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { TEXTURE_SETS, type TextureSetDef } from '../src/assets/textureManifest';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const cacheDir = path.join(repoRoot, '.cache', 'textures');
const outputRoot = path.join(repoRoot, 'public', 'textures');
const TEXTURE_SIZE = 1024;

async function downloadZip(set: TextureSetDef): Promise<Buffer> {
  mkdirSync(cacheDir, { recursive: true });
  const zipPath = path.join(cacheDir, `${set.id}.zip`);
  if (existsSync(zipPath)) return readFileSync(zipPath);

  console.log(`Downloading ${set.id}...`);
  const response = await fetch(set.url);
  if (!response.ok) throw new Error(`fetch-textures: ${set.id} — HTTP ${response.status} from ${set.url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(zipPath, buffer);
  return buffer;
}

function findEntry(entries: Record<string, Uint8Array>, suffix: string): Uint8Array {
  const key = Object.keys(entries).find((name) => name.endsWith(suffix));
  if (!key) throw new Error(`fetch-textures: no zip entry ending in "${suffix}" (found: ${Object.keys(entries).join(', ')})`);
  return entries[key];
}

function findEntryOptional(entries: Record<string, Uint8Array>, suffix: string): Uint8Array | null {
  const key = Object.keys(entries).find((name) => name.endsWith(suffix));
  return key ? entries[key] : null;
}

/** A flat, fully-lit ambient occlusion map: some ambientCG sets (e.g. flat asphalt) ship none. */
function neutralGrayscale(): Buffer {
  return Buffer.alloc(TEXTURE_SIZE * TEXTURE_SIZE, 255);
}

async function packArm(aoJpeg: Uint8Array | null, roughnessJpeg: Uint8Array): Promise<Buffer> {
  const ao = aoJpeg
    ? await sharp(Buffer.from(aoJpeg)).resize(TEXTURE_SIZE, TEXTURE_SIZE).grayscale().raw().toBuffer()
    : neutralGrayscale();
  const roughness = await sharp(Buffer.from(roughnessJpeg)).resize(TEXTURE_SIZE, TEXTURE_SIZE).grayscale().raw().toBuffer();
  const packed = Buffer.alloc(TEXTURE_SIZE * TEXTURE_SIZE * 3);
  for (let pixel = 0; pixel < TEXTURE_SIZE * TEXTURE_SIZE; pixel++) {
    packed[pixel * 3] = ao[pixel];         // R: ambient occlusion
    packed[pixel * 3 + 1] = roughness[pixel]; // G: roughness
    packed[pixel * 3 + 2] = 0;             // B: metalness — every set here is non-metal
  }
  return sharp(packed, { raw: { width: TEXTURE_SIZE, height: TEXTURE_SIZE, channels: 3 } }).webp({ quality: 85 }).toBuffer();
}

async function processSet(set: TextureSetDef): Promise<{ id: string; totalBytes: number }> {
  const zipBuffer = await downloadZip(set);
  const entries = unzipSync(new Uint8Array(zipBuffer));

  const colorJpeg = findEntry(entries, '_Color.jpg');
  const normalJpeg = findEntry(entries, '_NormalGL.jpg');
  const roughnessJpeg = findEntry(entries, '_Roughness.jpg');
  const aoJpeg = findEntryOptional(entries, '_AmbientOcclusion.jpg');
  if (!aoJpeg) console.warn(`  ${set.id}: no AmbientOcclusion map in this set — arm.webp's R channel is flat white (no darkening)`);

  const outDir = path.join(outputRoot, set.id);
  mkdirSync(outDir, { recursive: true });

  const colorWebp = await sharp(Buffer.from(colorJpeg)).resize(TEXTURE_SIZE, TEXTURE_SIZE).webp({ quality: 85 }).toBuffer();
  const normalWebp = await sharp(Buffer.from(normalJpeg)).resize(TEXTURE_SIZE, TEXTURE_SIZE).webp({ quality: 92 }).toBuffer();
  const armWebp = await packArm(aoJpeg, roughnessJpeg);

  writeFileSync(path.join(outDir, 'color.webp'), colorWebp);
  writeFileSync(path.join(outDir, 'normal.webp'), normalWebp);
  writeFileSync(path.join(outDir, 'arm.webp'), armWebp);

  const totalBytes = colorWebp.byteLength + normalWebp.byteLength + armWebp.byteLength;
  console.log(`  ${set.id}: color ${(colorWebp.byteLength / 1024).toFixed(1)} KB, normal ${(normalWebp.byteLength / 1024).toFixed(1)} KB, arm ${(armWebp.byteLength / 1024).toFixed(1)} KB`);
  return { id: set.id, totalBytes };
}

function writeLicenses(dateObtained: string): void {
  const lines = [
    '# public/textures/LICENSES.md',
    '',
    'Every texture set below is downloaded from ambientCG (CC0 1.0 — no attribution required) by',
    '`scripts/fetch-textures.ts`. Committed here so a fresh clone works offline.',
    '',
    '| id | display name | source | licence | date obtained |',
    '|---|---|---|---|---|',
    ...TEXTURE_SETS.map((set) => `| ${set.id} | ${set.displayName} | ${set.url} | ${set.licence} | ${dateObtained} |`),
    '',
  ];
  writeFileSync(path.join(outputRoot, 'LICENSES.md'), lines.join('\n'));
}

async function main(): Promise<void> {
  mkdirSync(outputRoot, { recursive: true });
  let totalBytes = 0;
  for (const set of TEXTURE_SETS) {
    const result = await processSet(set);
    totalBytes += result.totalBytes;
  }
  writeLicenses(new Date().toISOString().slice(0, 10));
  console.log(`Wrote ${TEXTURE_SETS.length} texture sets, ${(totalBytes / (1024 * 1024)).toFixed(2)} MB total, to ${outputRoot}`);
  const cacheSize = TEXTURE_SETS.reduce((sum, set) => {
    const zipPath = path.join(cacheDir, `${set.id}.zip`);
    return sum + (existsSync(zipPath) ? statSync(zipPath).size : 0);
  }, 0);
  console.log(`(.cache/textures/ holds ${(cacheSize / (1024 * 1024)).toFixed(1)} MB of raw downloads, gitignored)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
