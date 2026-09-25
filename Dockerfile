# Stage 1: build the client shell. The big files (models, sky, textures, sound) live on the
# asset CDN, so public/ is not in the build context and dist/ must hold only index.html + JS.
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_ASSET_BASE_URL
RUN test -n "$VITE_ASSET_BASE_URL" || { echo "build arg VITE_ASSET_BASE_URL is required (the asset CDN origin)"; exit 1; }
RUN npm run build \
  && test -f dist/index.html \
  && for folder in models props sky sound textures; do test ! -e "dist/$folder" || { echo "dist/$folder must not be in the image"; exit 1; }; done

# Stage 2: runtime. The server runs from its TypeScript sources through tsx and also imports
# world, physics and vehicle code from src/, so those ship as source.
FROM node:22-slim AS runtime
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
