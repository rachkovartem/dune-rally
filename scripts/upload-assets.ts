// scripts/upload-assets.ts
// Owner-only: publishes public/ (including the locally built car models) to R2 through
// wrangler, then writes the manifest. Run `npx wrangler login` once before the first run.
//   npm run assets:upload              upload what is missing, then write the manifest
//   npm run assets:upload -- --dry-run show what would be uploaded, write nothing
import { fileURLToPath } from 'node:url';
import { assetRootFor, ASSET_PREFIX } from '../src/assets/assetUrls';
import {
  ASSET_BUCKET, collectPublicFiles, DEFAULT_ASSET_BASE_URL, DEFAULT_PAGE_ORIGIN, localModelsFromCatalog,
  planUpload, readHttpsUrl, readPublishedManifest, uploadSet, type ObjectStore,
} from './lib/assetUpload';
import { createR2Store } from './lib/r2Store';

const UPLOAD_CONCURRENCY = 4;

async function main(): Promise<void> {
  const knownFlags = new Set(['--dry-run']);
  const unknownFlags = process.argv.slice(2).filter((flag) => !knownFlags.has(flag));
  if (unknownFlags.length > 0) throw new Error(`unknown argument(s): ${unknownFlags.join(' ')}`);
  const dryRun = process.argv.includes('--dry-run');

  const baseUrl = readHttpsUrl(process.env, 'ASSET_BASE_URL', DEFAULT_ASSET_BASE_URL);
  const publicRoot = assetRootFor(baseUrl);
  const publicDir = fileURLToPath(new URL('../public', import.meta.url));
  const r2Store = createR2Store({
    bucket: ASSET_BUCKET,
    prefix: ASSET_PREFIX,
    publicRoot,
    pageOrigin: readHttpsUrl(process.env, 'PAGE_ORIGIN', DEFAULT_PAGE_ORIGIN),
  });
  const store: ObjectStore = dryRun
    ? { ...r2Store, putFile: async () => undefined, putJson: async () => undefined }
    : r2Store;

  console.log(`asset root: ${publicRoot} (bucket ${ASSET_BUCKET}/${ASSET_PREFIX})${dryRun ? ' — dry run, nothing is written' : ''}`);
  const files = await collectPublicFiles(publicDir);
  const previous = await readPublishedManifest(r2Store);
  const plan = planUpload({ files, localModels: localModelsFromCatalog(), previous });
  for (const warning of plan.warnings) console.warn(`warning: ${warning}`);

  const result = await uploadSet({
    store,
    plan,
    concurrency: UPLOAD_CONCURRENCY,
    onFile: (path, status) => {
      if (status === 'uploaded') console.log(`${dryRun ? 'would upload' : 'uploaded'} ${path}`);
    },
  });
  const changedEntries = Object.entries(result.manifest.files)
    .filter(([path, key]) => previous?.files[path] !== key).length;
  console.log(
    `${dryRun ? 'would upload' : 'uploaded'} ${result.uploaded.length} file(s), ${result.skipped.length} already there; `
    + `manifest: ${Object.keys(result.manifest.files).length} entries, ${changedEntries} changed`
    + `${dryRun ? ' (not written)' : ` → ${publicRoot}/assets-manifest.json`}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
