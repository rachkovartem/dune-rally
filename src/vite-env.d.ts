/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CDN origin that holds `dune-rally/assets-manifest.json`; unset or empty in dev, where public/ is served. */
  readonly VITE_ASSET_BASE_URL: string | undefined;
  /** Replaces the game server WebSocket URL, for example to point a local production build at a dev server. */
  readonly VITE_GAME_SERVER_URL: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
