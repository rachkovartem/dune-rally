#!/usr/bin/env bash
# Runs on the VPS, started by .github/workflows/deploy.yml over ssh.
# Inputs: IMAGE_TAG and GHCR_USER in the environment, the GHCR token on stdin (never in argv).
# Pulls the image, restarts the container and waits until its health check passes.
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${GHCR_USER:?GHCR_USER is required}"
if [[ ! "$IMAGE_TAG" =~ ^(v[0-9]+\.[0-9]+\.[0-9]+|sha-[0-9a-f]{40})$ ]]; then
  echo "IMAGE_TAG must look like v1.2.3 or sha-<40 hex>, got: $IMAGE_TAG" >&2
  exit 1
fi

DEPLOY_DIR="$HOME/dune-rally"
CONTAINER=dune-rally
HEALTH_TIMEOUT_SECONDS=90
COMPOSE=(docker compose -f docker-compose.prod.yml)

cd "$DEPLOY_DIR"

GHCR_TOKEN="$(cat)"
if [[ -z "$GHCR_TOKEN" ]]; then
  echo "no GHCR token on stdin" >&2
  exit 1
fi

if ! docker network inspect web >/dev/null 2>&1; then
  echo "docker network 'web' does not exist: start nginx-proxy first" >&2
  exit 1
fi

# Remember the running tag, so a manual rollback knows what to go back to.
if [[ -f .env ]]; then
  previous_tag="$(sed -n 's/^IMAGE_TAG=//p' .env)"
  if [[ -n "$previous_tag" && "$previous_tag" != "$IMAGE_TAG" ]]; then
    printf '%s\n' "$previous_tag" > .previous-image-tag
  fi
fi
printf 'IMAGE_TAG=%s\n' "$IMAGE_TAG" > .env

trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
unset GHCR_TOKEN
"${COMPOSE[@]}" pull
docker logout ghcr.io >/dev/null

"${COMPOSE[@]}" up -d --remove-orphans

echo "waiting for $CONTAINER to become healthy (up to ${HEALTH_TIMEOUT_SECONDS}s)"
deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
while true; do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$CONTAINER")"
  if [[ "$status" == "healthy" ]]; then
    break
  fi
  if [[ "$status" == "no-healthcheck" || $SECONDS -ge $deadline ]]; then
    echo "$CONTAINER is not healthy (status: $status); last log lines:" >&2
    docker logs --tail 50 "$CONTAINER" >&2 || true
    exit 1
  fi
  sleep 3
done

# Only dangling layers go; tagged images stay on disk for a fast rollback.
docker image prune -f >/dev/null
echo "deployed ghcr.io/rachkovartem/dune-rally:$IMAGE_TAG"
