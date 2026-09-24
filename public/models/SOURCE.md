# public/models/pajero-sport.glb — source and licence

- **Title:** PAJERO SPORT 2014
- **Author:** razkat90
- **Source:** https://sketchfab.com/3d-models/pajero-sport-2014-d1dbce3648ce4046a9d5f0dcbbbbcda3
- **Licence:** Sketchfab Free Standard — free for use inside a game; the standalone asset (raw
  model file) may not be redistributed. That is why the source FBX is **not** committed to this
  repository, only the converted, in-game GLB.
- **Date obtained:** 2026-09-24
- **Converted with:** `scripts/convert-car.ts` (see that file for the full pipeline: FBX2glTF →
  drop camera/badge → strip normals/UVs → weld → simplify (wheels 10%, body 50%, two compounding
  passes — see `SIMPLIFY`'s doc comment in `src/assets/carPartRules.ts`) → split glass and
  rim/tyre primitives → weld → dedup/prune → meshopt-compress).
- **Manufacturer badge removed** — the spec requires an unbranded vehicle. The pipeline drops the
  raw FBX's `Plane` node (a 36-triangle badge decal at the grille centre) unconditionally.

## Reproducing this file

The FBX is not committed (licence, see above). To reproduce `pajero-sport.glb` from your own
copy of the source file:

```sh
npx tsx scripts/convert-car.ts <path-to-pajero-sport-2014.fbx>
```

This requires `FBX2glTF` (installed as the `fbx2gltf` devDependency). On Apple Silicon the
bundled binary is x86_64 and runs under Rosetta 2 — if it is missing, install it with
`softwareupdate --install-rosetta`. The script fails loudly (with this hint in the error
message) if the binary cannot start.

## What the pipeline measured

- Raw FBX2glTF export: 1,614,872 triangles, 30 nodes, 27 meshes, 2 placeholder materials, 0
  textures (untextured clay).
- Converted output: 83,063 drawn triangles across 34 named nodes, 329.6 KB (meshopt-compressed).
- `src/assets/carPartRules.ts`'s `measuredCar` constant is read off this converted GLB directly
  (printed by the script's own `printMeasuredCar` step), not copied from an earlier estimate.

## Node id -> material slot

Every node this pipeline produces has a documented material slot in
`src/assets/carPartRules.ts`'s `materialSlotFor()` — see that file for the full table (paint,
glass, chrome, rubber, rim, headlight, taillight, interior, blackTrim).
