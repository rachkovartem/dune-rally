// src/net/serverUrl.test.ts
// Category 1 (pure): where the client opens its WebSocket (deploy T1).
import { describe, it, expect } from 'vitest';
import { gameServerUrl } from './serverUrl';
import { SERVER_PORT } from '../../shared/protocol';

const PRODUCTION = { protocol: 'https:', host: 'rally.example', hostname: 'rally.example' };

describe('gameServerUrl — the game server\'s WebSocket URL (deploy T1)', () => {
  it('goes to the server\'s own port on the page\'s host name in dev', () => {
    expect(gameServerUrl({ protocol: 'http:', host: '192.168.1.5:5173', hostname: '192.168.1.5' }, { dev: true, override: undefined }))
      .toBe(`ws://192.168.1.5:${SERVER_PORT}`);
  });

  it('uses wss under /ws on an https page, so TLS and the origin are shared', () => {
    expect(gameServerUrl(PRODUCTION, { dev: false, override: undefined })).toBe('wss://rally.example/ws');
  });

  it('uses plain ws under /ws on an http page (a local production build)', () => {
    expect(gameServerUrl({ protocol: 'http:', host: 'localhost:2567', hostname: 'localhost' }, { dev: false, override: undefined })).toBe('ws://localhost:2567/ws');
  });

  it('keeps the page\'s port in production', () => {
    expect(gameServerUrl({ protocol: 'https:', host: 'rally.example:8443', hostname: 'rally.example' }, { dev: false, override: undefined })).toBe('wss://rally.example:8443/ws');
  });

  it.each([true, false])('takes an override over everything (dev %s)', (dev) => {
    expect(gameServerUrl(PRODUCTION, { dev, override: 'ws://other.example:9000' })).toBe('ws://other.example:9000');
  });

  it('treats an empty override as unset (an empty VITE_GAME_SERVER_URL in the build)', () => {
    expect(gameServerUrl(PRODUCTION, { dev: false, override: '' })).toBe('wss://rally.example/ws');
  });
});
