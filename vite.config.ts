import { defineConfig } from 'vite';
import { SERVER_PORT } from './shared/protocol';
import packageJson from './package.json';

const appVersion = process.env.VITE_APP_VERSION || `v${packageJson.version}`;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  // With a CDN the files in public/ are uploaded there, so they stay out of dist/ and the image.
  publicDir: process.env.VITE_ASSET_BASE_URL ? false : 'public',
  server: {
    // In production the game server answers /health on the page's own origin; this keeps dev the same.
    proxy: { '/health': `http://localhost:${SERVER_PORT}` },
  },
  build: {
    target: 'esnext',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
