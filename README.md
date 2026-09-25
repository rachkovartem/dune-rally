# DUNE RALLY

A browser-based, real-time **multiplayer off-road driving game** — drive an SUV across an
endless, procedurally generated, cel-shaded desert. Built with TypeScript, three.js,
Rapier (WASM physics) and Colyseus.

> ⚠️ Early work-in-progress / tech demo. It drives and you can see other players, but it is
> not a finished game yet — see [Status](#status).

## Features

- 🏜️ **Procedural world** — deterministic, seed-based terrain streamed in chunks (Web Worker).
  12 surface types (sand, grass, forest, dirt, rock, gravel, snow, road, mud, beach, water…)
  with crisp per-face colouring.
- 🚙 **Drivable SUV** — raycast-vehicle physics (Rapier): suspension, AWD, steering, a heavy
  "planted" feel, a low-poly Pajero-Sport-style model with steering/rolling wheels.
- 🌐 **Real-time multiplayer** — authoritative Colyseus server simulates every buggy; clients
  send inputs and render all players (own + remote) with interpolation.
- 🎨 **Cel-shaded look** — toon shading + ink outlines, hazy desert lighting.
- 🛞 **Detail** — terrain-hugging tyre trails, a real directional shadow, a water plane that
  fills low canyons, scattered props (trees, bushes, cacti, rocks) that get knocked over by
  the car, and a HUD with a speedometer + online count.
- 🔊 **Procedural audio** (Web Audio) — engine that rises with speed/throttle, surface-matched
  tyre rustle, wind, and impact one-shots. No audio files.

## Tech stack

- **Client:** TypeScript, Vite, [three.js](https://threejs.org), `@dimforge/rapier3d-compat`
  (Rapier WASM), Web Audio.
- **Server:** Node.js, [Colyseus](https://colyseus.io) (`@colyseus/core` + `@colyseus/schema`),
  Rapier WASM, run via `tsx`.
- **Shared:** framework-free pure modules (world generation, vehicle config, net protocol) used
  by both client and server.
- **Tests:** Vitest (pure logic — seed/noise/chunk/geometry/interpolation/protocol/physics).

## Running locally

```bash
npm install

# 1) start the multiplayer server (Colyseus on :2567)
npm run server

# 2) in another terminal, start the client (Vite on :5173)
npm run dev
```

Open <http://localhost:5173>, click **“▶ Нажми, чтобы ехать”** (this also unlocks audio), and
drive. Open a second tab to see multiplayer. Append `?seed=<anything>` to the URL to load a
specific world.

```bash
npm test        # run unit tests
npm run build   # type-check + production build
```

## Deploy

Production: `https://rally.coreplex.cc`. The game server runs in one Docker container on the
VPS behind `nginx-proxy`; the big files (models, sky, textures, sound) are on Cloudflare R2 at
`https://assets.coreplex.cc/dune-rally/`, listed in `assets-manifest.json`.

**Publish assets** (from the owner's machine only; CI has no Cloudflare credentials):

```bash
npx wrangler login               # once per machine
npm run assets:upload -- --dry-run   # optional: see what would change
npm run assets:upload            # uploads missing files, then writes the manifest
```

Run it after every change in `public/` and after every `scripts/convert-*.ts` run. The script
uploads only files whose content hash is new, so a second run uploads nothing.
`npm run assets:verify` runs the same check CI does before a release.

**Release:** merge to `main`, then push a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/deploy.yml` runs the tests and the build, checks the published assets, builds
the image `ghcr.io/rachkovartem/dune-rally:<tag>` and deploys it over SSH.

**Rollback:** Actions → Deploy → Run workflow, `image_tag` = an older tag (for example `v0.1.0`).
On the server, `~/dune-rally/.previous-image-tag` holds the tag that ran before the last deploy.

Local production check: `npm run build && CLIENT_DIST_DIR=dist npm run server:prod`
(`/health` answers on port 2567).

A local `docker build` needs `release/assets-manifest.json` (CI downloads it) and the CDN build arg:

```bash
mkdir -p release && curl -fsS -o release/assets-manifest.json https://assets.coreplex.cc/dune-rally/assets-manifest.json
docker build --build-arg VITE_ASSET_BASE_URL=https://assets.coreplex.cc -t dune-rally:local .
```

A local `npm run build` with `VITE_ASSET_BASE_URL` set reads the manifest from the page origin, so copy
the same file to `dist/assets-manifest.json` before starting the server.

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | accelerate |
| `S` / `↓` | brake / reverse |
| `A` `D` / `←` `→` | steer |
| `R` | flip the car back upright |

## Architecture

- The **local player's** car is simulated on the client at 60 fps (Rapier) for responsive
  control, and its inputs are also sent to the server.
- The **server** is authoritative: it runs Rapier for every player in a bounded arena and
  syncs transforms; clients render remote players from that state with interpolation.
- World generation, the vehicle config, and the network protocol live in framework-free
  `shared`/`src/world` modules so the client and server stay in sync.

## Status

A multiplayer foundation + a lot of game-feel polish. Known rough edges:

- The car can occasionally jam on sharp terrain edges.
- Multiplayer has no client-side prediction yet (your own car is locally simulated; remote
  players are server-driven), so it is tuned for low latency.
- No gameplay objective yet (no races/checkpoints) — it's free-roam.

## Layout

```
src/        client (render, vehicle, world streaming, input, net, audio)
server/     Colyseus server (arena room + authoritative Rapier sim)
shared/     pure code shared by client & server (protocol, vehicle physics)
```
