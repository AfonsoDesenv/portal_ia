import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listenError, pickWebDir, shutdown } from '../server/startup.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portal-startup-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('pickWebDir', () => {
  it('ignora pasta com index.html sem assets/ (fonte do Vite) e escolhe o build', () => {
    const src = join(dir, 'web');
    mkdirSync(src);
    writeFileSync(join(src, 'index.html'), '<script type="module" src="/src/main.tsx"></script>');
    expect(pickWebDir([src])).toBeUndefined();
    const built = join(dir, 'dist', 'web');
    mkdirSync(join(built, 'assets'), { recursive: true });
    writeFileSync(join(built, 'index.html'), '<html></html>');
    expect(pickWebDir([src, built])).toBe(built);
  });
});

describe('listenError', () => {
  it('EADDRINUSE vira mensagem amigável', () => {
    const e = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    expect(listenError(e, 4317)).toBe('Portal IA já está rodando em http://localhost:4317');
  });
  it('outros erros mantêm a mensagem', () => {
    expect(listenError(new Error('boom'), 4317)).toContain('boom');
  });
});

describe('shutdown', () => {
  it('encerra os ptys e fecha o app', async () => {
    const killAll = vi.fn();
    const close = vi.fn(async () => {});
    await shutdown({ killAll }, { close });
    expect(killAll).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
