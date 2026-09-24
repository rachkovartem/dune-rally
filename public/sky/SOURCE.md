# public/sky — source and licence

- **Asset:** `goegap` — a Karoo/Namaqualand (South Africa) desert HDRI.
- **Author / source:** Poly Haven, https://polyhaven.com/a/goegap
- **Licence:** CC0 1.0 (public domain, no attribution required).
- **Date obtained:** 2026-09-24.
- **Files:**
  - `goegap_1k.hdr` (1.36 MB) — the 1K equirectangular HDR, `FloatType`. Loaded with
    `HDRLoader` (three's replacement for the deprecated `RGBELoader`), clamped (max 6) and fed through `PMREMGenerator` for `scene.environment`
    (image-based lighting). The same file's brightest texel gives the sun direction
    (`brightestTexelDirection`, see `src/render/sky.ts`).
  - `goegap_sky_4k.webp` (0.97 MB) — the 4K tonemapped sky image (Poly Haven's `tonemapped.url`)
    re-encoded to WebP, used directly as `scene.background` (equirectangular, sRGB) for a
    sharper horizon than the 1K HDR would give at a fraction of the bytes.

## How these files were obtained for this task

`scripts/fetch-sky.ts` (Poly Haven API `GET https://api.polyhaven.com/files/goegap` →
`hdri['1k'].hdr.url` + `hdri['4k'].tonemapped.url` → `sharp` to WebP) is the reproducible
version of this step and is planned as a follow-up (backend-dev, plan v2's A0). For this run the
two files were copied byte-for-byte from the feasibility spike
(`scratchpad/spike/public/goegap_1k.hdr`, `scratchpad/spike/public/goegap_sky_4k.webp`), which
obtained them from the same Poly Haven URLs — see the plan's Risk 5 fallback ("the spike's files
on disk are a byte-identical manual fallback").
