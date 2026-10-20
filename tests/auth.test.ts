import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../server/config.js';
import { buildApp } from '../server/app.js';

let dir: string;
let app: FastifyInstance;
let token: string;
let host: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'portal-ia-'));
  const config = loadConfig(dir);
  token = config.token;
  host = `localhost:${config.port}`;
  app = buildApp({ config });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('autenticação', () => {
  it('rejeita /api/health sem cookie com 401', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host } });
    expect(res.statusCode).toBe(401);
  });

  it('rejeita cookie errado com 401', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host, cookie: 'portal_key=errado' } });
    expect(res.statusCode).toBe(401);
  });

  it('GET /?key=<token> grava o cookie e redireciona para /', async () => {
    const res = await app.inject({ url: `/?key=${token}`, headers: { host } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain(`portal_key=${token}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });

  it('GET /?key=errado não grava cookie', async () => {
    const res = await app.inject({ url: '/?key=errado', headers: { host } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('aceita /api/health com cookie certo', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host, cookie: `portal_key=${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('rejeita Host estranho com 403', async () => {
    const res = await app.inject({ url: '/api/health', headers: { host: 'evil.com', cookie: `portal_key=${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it('rejeita upgrade WS com Origin estranho com 403', async () => {
    const res = await app.inject({
      url: '/api/health',
      headers: { host, cookie: `portal_key=${token}`, upgrade: 'websocket', origin: 'http://evil.com' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('aceita upgrade WS com Origin do próprio portal', async () => {
    const res = await app.inject({
      url: '/api/health',
      headers: { host, cookie: `portal_key=${token}`, upgrade: 'websocket', origin: `http://${host}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('CSRF em requests que alteram estado', () => {
  const post = (extra: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/nada', headers: { host, cookie: `portal_key=${token}`, ...extra } });

  it('rejeita POST com Origin de outro site', async () => {
    expect((await post({ origin: 'http://evil.com' })).statusCode).toBe(403);
    expect((await post({ origin: 'http://localhost:9999' })).statusCode).toBe(403);
  });

  it('aceita POST com Origin do portal (localhost ou 127.0.0.1) ou sem Origin', async () => {
    const port = host.split(':')[1];
    expect((await post({ origin: `http://${host}` })).statusCode).toBe(404);
    expect((await post({ origin: `http://127.0.0.1:${port}` })).statusCode).toBe(404);
    expect((await post({})).statusCode).toBe(404);
  });

  it('rejeita POST com Sec-Fetch-Site diferente de same-origin', async () => {
    expect((await post({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await post({ 'sec-fetch-site': 'same-site' })).statusCode).toBe(403);
    expect((await post({ 'sec-fetch-site': 'same-origin' })).statusCode).toBe(404);
  });

  it('GET não é afetado por Origin/Sec-Fetch-Site', async () => {
    const res = await app.inject({
      url: '/api/health',
      headers: { host, cookie: `portal_key=${token}`, origin: 'http://evil.com', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('loadConfig', () => {
  it('devolve o mesmo token nas duas chamadas e as pastas base padrão', () => {
    const a = loadConfig(dir);
    const b = loadConfig(dir);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(b.token).toBe(a.token);
    expect(a.roots).toEqual({ windows: 'C:' + String.fromCharCode(92) + 'GIT', wsl: '~/git' });
    expect(a.port).toBe(4317);
    expect(a.dataDir).toBe(dir);
  });
});
