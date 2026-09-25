// scripts/remoteDeploy.test.ts
// Category 4: deploy/remote-deploy.sh runs against a stand-in `docker` on PATH (review round 2).
// The stand-in keeps what a real server would show: which tag and which compose file run now, and
// whether that container is healthy. A release is unhealthy when its tag is the one named in
// UNHEALTHY_TAG or its compose file says "broken".
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../deploy/remote-deploy.sh', import.meta.url));
const EARLIER_TAG = 'v0.9.0';
const OLD_TAG = 'v1.0.0';
const NEW_TAG = 'v1.1.0';
const OLD_COMPOSE = 'release: old\n';
const NEW_COMPOSE = 'release: new\n';
const BROKEN_COMPOSE = 'release: new, broken\n';

const FAKE_DOCKER = `#!/bin/sh
state="$HOME/docker-state"
case "$1" in
  network) exit 0 ;;
  login) cat >/dev/null; exit 0 ;;
  logout|logs|image) exit 0 ;;
  inspect) cat "$state/health" 2>/dev/null || echo missing; exit 0 ;;
  compose)
    file="$3"
    command="$4"
    if [ "$command" = up ]; then
      printf '%s\\n' "$IMAGE_TAG" > "$state/running-tag"
      cp "$file" "$state/running-compose"
      if [ "$IMAGE_TAG" = "$UNHEALTHY_TAG" ] || grep -q broken "$file"; then
        echo no-healthcheck > "$state/health"
      else
        echo healthy > "$state/health"
      fi
    fi
    exit 0 ;;
esac
exit 0
`;

interface Server {
  home: string;
  deployDir: string;
}

const servers: string[] = [];

afterEach(() => {
  for (const home of servers.splice(0)) rmSync(home, { recursive: true, force: true });
});

/** A server home with the given files in ~/dune-rally; a file set to null or left out is not there. */
function serverWith(files: { env: string | null; compose: string | null; newCompose: string | null; previousTag?: string }): Server {
  const home = mkdtempSync(join(tmpdir(), 'dune-rally-deploy-'));
  servers.push(home);
  const deployDir = join(home, 'dune-rally');
  mkdirSync(deployDir);
  mkdirSync(join(home, 'docker-state'));
  mkdirSync(join(home, 'bin'));
  writeFileSync(join(home, 'bin', 'docker'), FAKE_DOCKER);
  chmodSync(join(home, 'bin', 'docker'), 0o755);
  if (files.env !== null) writeFileSync(join(deployDir, '.env'), files.env);
  if (files.compose !== null) writeFileSync(join(deployDir, 'docker-compose.prod.yml'), files.compose);
  if (files.newCompose !== null) writeFileSync(join(deployDir, 'docker-compose.prod.yml.new'), files.newCompose);
  if (files.previousTag !== undefined) writeFileSync(join(deployDir, '.previous-image-tag'), `${files.previousTag}\n`);
  return { home, deployDir };
}

function deploy(server: Server, unhealthyTag = ''): number | null {
  const result = spawnSync('bash', [SCRIPT], {
    input: 'ghcr-token',
    encoding: 'utf8',
    env: {
      PATH: `${join(server.home, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: server.home,
      IMAGE_TAG: NEW_TAG,
      GHCR_USER: 'deployer',
      UNHEALTHY_TAG: unhealthyTag,
    },
  });
  return result.status;
}

function readOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** What runs on the server after the deploy, and what the next deploy will read. */
function stateOf(server: Server) {
  return {
    runningTag: readOrNull(join(server.home, 'docker-state', 'running-tag'))?.trim() ?? null,
    runningCompose: readOrNull(join(server.home, 'docker-state', 'running-compose')),
    envTag: readOrNull(join(server.deployDir, '.env'))?.trim() ?? null,
    compose: readOrNull(join(server.deployDir, 'docker-compose.prod.yml')),
    newCompose: readOrNull(join(server.deployDir, 'docker-compose.prod.yml.new')),
    // The tag a manual rollback goes back to.
    previousTag: readOrNull(join(server.deployDir, '.previous-image-tag'))?.trim() ?? null,
  };
}

describe('remote-deploy.sh — the release compose file and the rollback', () => {
  it('stops before anything changes when the release compose file was not uploaded', () => {
    const server = serverWith({ env: `IMAGE_TAG=${OLD_TAG}\n`, compose: OLD_COMPOSE, newCompose: null });
    expect(deploy(server)).toBe(1);
    expect(stateOf(server)).toEqual({ runningTag: null, runningCompose: null, envTag: `IMAGE_TAG=${OLD_TAG}`, compose: OLD_COMPOSE, newCompose: null, previousTag: null });
  });

  it('starts a healthy release with its own compose file, which then replaces the old one', () => {
    const server = serverWith({ env: `IMAGE_TAG=${OLD_TAG}\n`, compose: OLD_COMPOSE, newCompose: NEW_COMPOSE });
    expect(deploy(server)).toBe(0);
    expect(stateOf(server)).toEqual({
      runningTag: NEW_TAG, runningCompose: NEW_COMPOSE, envTag: `IMAGE_TAG=${NEW_TAG}`, compose: NEW_COMPOSE, newCompose: null, previousTag: OLD_TAG,
    });
  });

  it('rolls an unhealthy release back to the previous tag with the previous compose file, and keeps the new file', () => {
    const server = serverWith({ env: `IMAGE_TAG=${OLD_TAG}\n`, compose: OLD_COMPOSE, newCompose: NEW_COMPOSE });
    expect(deploy(server, NEW_TAG)).toBe(1);
    expect(stateOf(server)).toEqual({
      runningTag: OLD_TAG, runningCompose: OLD_COMPOSE, envTag: `IMAGE_TAG=${OLD_TAG}`, compose: OLD_COMPOSE, newCompose: NEW_COMPOSE, previousTag: null,
    });
  });

  it('keeps the tag a manual rollback goes back to when the release is rolled back', () => {
    const server = serverWith({ env: `IMAGE_TAG=${OLD_TAG}\n`, compose: OLD_COMPOSE, newCompose: NEW_COMPOSE, previousTag: EARLIER_TAG });
    expect(deploy(server, NEW_TAG)).toBe(1);
    expect(stateOf(server)).toMatchObject({ runningTag: OLD_TAG, previousTag: EARLIER_TAG });
  });

  it('rolls back a broken compose file even when the tag stays the same', () => {
    const server = serverWith({ env: `IMAGE_TAG=${NEW_TAG}\n`, compose: OLD_COMPOSE, newCompose: BROKEN_COMPOSE });
    expect(deploy(server)).toBe(1);
    expect(stateOf(server)).toMatchObject({ runningTag: NEW_TAG, runningCompose: OLD_COMPOSE, compose: OLD_COMPOSE, newCompose: BROKEN_COMPOSE });
  });

  it('fails the first deploy with no rollback: there is no earlier compose file to go back to', () => {
    const server = serverWith({ env: null, compose: null, newCompose: NEW_COMPOSE });
    expect(deploy(server, NEW_TAG)).toBe(1);
    expect(stateOf(server)).toMatchObject({ runningTag: NEW_TAG, runningCompose: NEW_COMPOSE, compose: null, newCompose: NEW_COMPOSE });
  });

  it.each([['an empty tag', 'IMAGE_TAG=\n'], ['a tag that is not a release tag', 'IMAGE_TAG=latest\n']])(
    'does not roll back to %s from .env',
    (_name, env) => {
      const server = serverWith({ env, compose: OLD_COMPOSE, newCompose: NEW_COMPOSE });
      expect(deploy(server, NEW_TAG)).toBe(1);
      expect(stateOf(server)).toMatchObject({ runningTag: NEW_TAG, runningCompose: NEW_COMPOSE, compose: OLD_COMPOSE });
    },
  );
});
