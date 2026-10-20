import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gitFile envia oldPath só quando houver (renomeação)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ original: '', modified: '', binary: false })));
    vi.stubGlobal('fetch', fetchMock);
    await api.gitFile('p 1', 'novo ação.ts', 'velho.ts');
    await api.gitFile('p 1', 'a.ts');
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      '/api/projects/p%201/git/file?path=novo%20a%C3%A7%C3%A3o.ts&oldPath=velho.ts',
      '/api/projects/p%201/git/file?path=a.ts',
    ]);
  });

  it('abrir/fechar projeto e trocar ativo usam rotas separadas', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ openProjectIds: [], activeProjectId: null })));
    vi.stubGlobal('fetch', fetchMock);
    await api.openProject('a');
    await api.closeProject('a');
    await api.putOpen('b');
    const calls = fetchMock.mock.calls.map((c) => {
      const [url, init] = c as unknown as [string, RequestInit];
      return [init.method, url, init.body ?? null];
    });
    expect(calls).toEqual([
      ['POST', '/api/projects/a/open', null],
      ['POST', '/api/projects/a/close', null],
      ['PUT', '/api/open', JSON.stringify({ activeProjectId: 'b' })],
    ]);
  });
});
