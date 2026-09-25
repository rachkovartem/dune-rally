// server/config.test.ts
// Category 1 (readPort) and category 4 (readClientDistDir reads the file system): the production
// start settings (deploy T3).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClientDistDir, readPort } from './config';
import { SERVER_PORT } from '../shared/protocol';

describe('readPort — PORT from the environment (deploy T3)', () => {
  it.each<[string, string | undefined]>([['unset', undefined], ['empty', ''], ['only spaces', '   ']])('uses the dev port when PORT is %s', (_name, value) => {
    expect(readPort({ PORT: value })).toBe(SERVER_PORT);
  });

  it.each<[string, number]>([['3000', 3000], [' 8080 ', 8080], ['1', 1], ['65535', 65535]])('reads "%s" as %s', (value, expected) => {
    expect(readPort({ PORT: value })).toBe(expected);
  });

  it.each(['abc', '0', '65536', '70000', '-1', '3000.5', '1e3', '30 00'])('stops the start for PORT "%s" instead of listening somewhere else', (value) => {
    expect(() => readPort({ PORT: value })).toThrow('PORT must be a whole number from 1 to 65535');
  });
});

describe('readClientDistDir — CLIENT_DIST_DIR from the environment (deploy T3)', () => {
  let root = '';
  let built = '';
  let empty = '';
  let file = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'dune-rally-config-'));
    built = join(root, 'dist');
    mkdirSync(built);
    writeFileSync(join(built, 'index.html'), '<!doctype html>');
    empty = join(root, 'empty');
    mkdirSync(empty);
    file = join(root, 'file.txt');
    writeFileSync(file, 'not a directory');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each<[string, string | undefined]>([['unset', undefined], ['empty', ''], ['only spaces', ' ']])('means dev (Vite serves the client) when it is %s', (_name, value) => {
    expect(readClientDistDir({ CLIENT_DIST_DIR: value })).toBeNull();
  });

  it('gives back the absolute path of a built client', () => {
    expect(readClientDistDir({ CLIENT_DIST_DIR: ` ${built} ` })).toBe(built);
  });

  it('stops the start for a path that does not exist, or is a file', () => {
    expect(() => readClientDistDir({ CLIENT_DIST_DIR: join(root, 'missing') })).toThrow('is not a directory');
    expect(() => readClientDistDir({ CLIENT_DIST_DIR: file })).toThrow('is not a directory');
  });

  it('stops the start for a directory with no index.html (the build was not run)', () => {
    expect(() => readClientDistDir({ CLIENT_DIST_DIR: empty })).toThrow('no index.html');
  });
});
