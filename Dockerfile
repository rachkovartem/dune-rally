# node:22-slim, pinned by digest so a rebuild of an old tag gets the same base. To update:
# docker buildx imagetools inspect node:22-slim, then change the digest in this ARG (both FROM lines use it).
ARG NODE_IMAGE=node:22-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

# Stage 1: build the client shell. The big files (models, sky, textures, sound) live on the
# asset CDN, so public/ is not in the build context and dist/ must hold only index.html + JS.
FROM $NODE_IMAGE AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_ASSET_BASE_URL
RUN test -n "$VITE_ASSET_BASE_URL" || { echo "build arg VITE_ASSET_BASE_URL is required (the asset CDN origin)"; exit 1; }
RUN npm run build \
  && test -f dist/index.html \
  && for folder in models props sky sound textures; do test ! -e "dist/$folder" || { echo "dist/$folder must not be in the image"; exit 1; }; done
# The asset list of this release, downloaded and verified by CI. The client reads it from the page's
# own origin, so a rollback to this image also goes back to the assets it was built with.
RUN test -s release/assets-manifest.json || { echo "release/assets-manifest.json is required (CI downloads and verifies it)"; exit 1; } \
  && node -e "JSON.parse(require('node:fs').readFileSync('release/assets-manifest.json', 'utf8'))" \
  && cp release/assets-manifest.json dist/assets-manifest.json \
  && sha256sum dist/assets-manifest.json

# Stage 2: runtime. The server runs from its TypeScript sources through tsx and also imports
# world, physics and vehicle code from src/, so those ship as source.
FROM $NODE_IMAGE AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY tsconfig.json ./
COPY server ./server
COPY shared ./shared
COPY src ./src
COPY --from=builder /app/dist ./dist

USER node
ENV PORT=2567 CLIENT_DIST_DIR=/app/dist
EXPOSE 2567

# slim images have no curl or wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]

# node itself is the main process, so SIGTERM from docker stop reaches Colyseus' graceful shutdown.
CMD ["node", "--import", "tsx", "server/index.ts"]
