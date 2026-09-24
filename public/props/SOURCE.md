# public/props — source and licence

All seven models are from **Poly Haven** (https://polyhaven.com), licence **CC0 1.0** (public
domain, no attribution required). Obtained 2026-09-24.

| file | Poly Haven asset | kept triangles |
|---|---|---|
| `namaqualand_boulder_02.glb` | https://polyhaven.com/a/namaqualand_boulder_02 | 7 835 |
| `namaqualand_boulder_03.glb` | https://polyhaven.com/a/namaqualand_boulder_03 | 6 481 |
| `namaqualand_boulder_05.glb` | https://polyhaven.com/a/namaqualand_boulder_05 | 7 166 |
| `namaqualand_stones_01.glb` | https://polyhaven.com/a/namaqualand_stones_01 | 7 012 |
| `dead_tree_trunk_02.glb` | https://polyhaven.com/a/dead_tree_trunk_02 | 6 643 |
| `wild_rooibos_bush.glb` | https://polyhaven.com/a/wild_rooibos_bush | 29 519 |
| `grass_medium_02.glb` | https://polyhaven.com/a/grass_medium_02 | 714 – 2 489 per clump |

## How these files were built

They are copied byte for byte from the drive prototype (the feasibility spike), which built
them from the Poly Haven 1K glTF downloads in two steps:

1. `bakeAlpha` — for the bush and the grass, the separate alpha map is baked into the colour
   PNG and the material is switched from `BLEND` to `MASK` (cut-off 0.5).
2. `optimize` — gltf-transform: `dedup`, `weld`, meshoptimizer `simplify` (boulders and log to
   8 %, boulder 03 and stones to 10 %, bush and grass untouched), textures to WebP (1024 px,
   stones 512 px, quality 82), `prune`, meshopt compression.

A reproducible `scripts/fetch-props.ts` doing the same is planned as a follow-up (plan v2, step D).
