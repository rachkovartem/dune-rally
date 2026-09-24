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

---

# public/models/forester-2019.glb — source

- **Title:** Subaru Forester 2019
- **Source:** Forester model provided by the project owner (archive "Subaru Forester 2019 3D
  Model.zip"); converted with `scripts/convert-forester.ts`.
- **Not committed:** `public/models/forester-2019.glb` is in `.gitignore`. On a fresh clone the
  game shows "Forester model missing — run npx tsx scripts/convert-forester.ts <fbx>" until the
  file is built locally.

## Building this file

```sh
npx tsx scripts/convert-forester.ts "<dir>/subaru-forester-2019.fbx"
```

The script reads the FBX and four textures from `<dir>/textures/` (`Tire_04_DM.jpg`,
`Tire_04_NM.jpg`, `Brakes_01_DM.jpg`, `Brakes_01_NM.jpg`). It needs `FBX2glTF` (the `fbx2gltf`
devDependency; on Apple Silicon it runs under Rosetta 2, see the Pajero section above).

## What the pipeline does

- Raw node names are `desirefx.me_NNN`. Every node is classified by
  `classifyForesterNode()` in `src/assets/foresterPartRules.ts` into one clean id per material
  slot or wheel-corner part.
- **Removed:** 8 manufacturer badges, 8 wheel-cap badges, and every node with the `blue`
  material (brand oval) — the spec requires an unbranded vehicle.
- **Plate:** `plate.jpg` and `plate0.jpg` are never read; the plate stays a neutral, untextured
  surface.
- Normals are stripped (creased at load time); UVs are kept only on the tyre and the brake disc,
  whose textures ship inside the GLB as WebP (tyre 1024 px, brake 512 px).
- Each clean id is simplified to its triangle budget (`FORESTER_TRIANGLE_TARGETS`) and joined
  into one primitive; wheel parts are centred on their hub.
- Result (2026-09-24): 31 nodes, 128,575 drawn triangles (raw 1,294,622 after deletion),
  749.2 KB (meshopt-compressed). `measuredCarForester` is copied from the script's printout.
