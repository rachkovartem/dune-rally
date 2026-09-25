#!/usr/bin/env bash
# Runs on the VPS, started by .github/workflows/deploy.yml over ssh.
# Inputs: IMAGE_TAG and GHCR_USER in the environment, the GHCR token on stdin (never in argv).
# Pulls the image, restarts the container and waits until its health check passes. When the new
# image does not become healthy, the previous tag is started again and the script exits 1.
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

# The tag that runs now; empty on the first deploy.
previous_tag=""
if [[ -f .env ]]; then
  previous_tag="$(sed -n 's/^IMAGE_TAG=//p' .env)"
fi

# Every compose call gets its tag explicitly: IMAGE_TAG in this shell is the new tag, and compose
# prefers the shell's value to the one in .env.
compose_with_tag() {
  local tag=$1
  shift
  IMAGE_TAG="$tag" "${COMPOSE[@]}" "$@"
}

# Returns 0 once the container reports healthy, 1 on timeout or when it has no health check.
wait_until_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  local status
  echo "waiting for $CONTAINER to become healthy (up to ${HEALTH_TIMEOUT_SECONDS}s)"
  while true; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "no-healthcheck" || $SECONDS -ge $deadline ]]; then
      echo "$CONTAINER is not healthy (status: $status); last log lines:" >&2
      docker logs --tail 50 "$CONTAINER" >&2 || true
      return 1
    fi
    sleep 3
  done
}

trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
unset GHCR_TOKEN
# A failed pull stops here, before .env changes: the running container and its tag stay as they are.
compose_with_tag "$IMAGE_TAG" pull
docker logout ghcr.io >/dev/null

if [[ -n "$previous_tag" && "$previous_tag" != "$IMAGE_TAG" ]]; then
  printf '%s\n' "$previous_tag" > .previous-image-tag
fi
printf 'IMAGE_TAG=%s\n' "$IMAGE_TAG" > .env

if compose_with_tag "$IMAGE_TAG" up -d --remove-orphans && wait_until_healthy; then
  # Only dangling layers go; tagged images stay on disk for a fast rollback.
  docker image prune -f >/dev/null
  echo "deployed ghcr.io/rachkovartem/dune-rally:$IMAGE_TAG"
  exit 0
fi

if [[ -z "$previous_tag" || "$previous_tag" == "$IMAGE_TAG" ]]; then
  echo "deploy of $IMAGE_TAG failed and there is no earlier tag to go back to" >&2
  exit 1
fi

echo "deploy of $IMAGE_TAG failed; rolling back to $previous_tag" >&2
printf 'IMAGE_TAG=%s\n' "$previous_tag" > .env
if compose_with_tag "$previous_tag" up -d --remove-orphans && wait_until_healthy; then
  echo "rolled back to ghcr.io/rachkovartem/dune-rally:$previous_tag; the release $IMAGE_TAG is NOT live" >&2
else
  echo "rollback to $previous_tag is not healthy either: the game is down, look at the server now" >&2
fi
exit 1
