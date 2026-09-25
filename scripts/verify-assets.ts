// scripts/verify-assets.ts
// Release gate, run by CI with no credentials: reads the public manifest and checks that every
// committed asset is published at its current hash and that the required car model is reachable.
// With ASSET_MANIFEST_PATH set, the manifest is read from that file (the copy the image will carry).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assetRootFor, ASSET_PREFIX } from '../src/assets/assetUrls';
import {
  ASSET_BUCKET, collectPublicFiles, DEFAULT_ASSET_BASE_URL, DEFAULT_PAGE_ORIGIN, localModelsFromCatalog,
  readHttpsUrl, verifyPublished, withManifestText,
} from './lib/assetUpload';
import { createR2Store } from './lib/r2Store';

const CHECK_CONCURRENCY = 8;

async function main(): Promise<void> {
  const baseUrl = readHttpsUrl(process.env, 'ASSET_BASE_URL', DEFAULT_ASSET_BASE_URL);
  const pageOrigin = readHttpsUrl(process.env, 'PAGE_ORIGIN', DEFAULT_PAGE_ORIGIN);
  const publicRoot = assetRootFor(baseUrl);
  const publicDir = fileURLToPath(new URL('../public', import.meta.url));
  const liveStore = createR2Store({ bucket: ASSET_BUCKET, prefix: ASSET_PREFIX, publicRoot, pageOrigin });
  const manifestPath = process.env.ASSET_MANIFEST_PATH?.trim() ?? '';
  const store = manifestPath === '' ? liveStore : withManifestText(liveStore, await readFile(manifestPath, 'utf8'));

  const localModels = localModelsFromCatalog();
  const localPaths = new Set(localModels.map((model) => model.path));
  // On the owner's machine public/ also holds the local models; those are checked by name only.
  const committedFiles = (await collectPublicFiles(publicDir)).filter((file) => !localPaths.has(file.path));

  const manifestSource = manifestPath === '' ? `${publicRoot}/assets-manifest.json` : manifestPath;
  console.log(`verifying ${manifestSource} against ${committedFiles.length} committed file(s)`);
  const result = await verifyPublished({ store, committedFiles, localModels, pageOrigin, concurrency: CHECK_CONCURRENCY });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  for (const error of result.errors) console.error(`error: ${error}`);
  if (result.errors.length > 0) {
    console.error(`asset check failed with ${result.errors.length} error(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('asset check passed');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
