import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  api: {
    putOpen: vi.fn(),
    openProject: vi.fn(),
    closeProject: vi.fn(),
    sessions: vi.fn(),
    projects: vi.fn(),
  },
}));

import { api } from './api';
import { useApp } from './store';

const pv = (id: string) => ({ id, name: id, env: 'windows' as const, path: `C:\\${id}`, createdAt: '', missing: false });

describe('store: abas de projetos', () => {
  beforeEach(() => {
    useApp.setState({ projects: [pv('a'), pv('b'), pv('c')], openIds: ['a'], activeId: 'a', sessions: {}, openVersion: -1 });
    vi.mocked(api.sessions).mockResolvedValue([]);
    vi.mocked(api.projects).mockResolvedValue([pv('a'), pv('b'), pv('c')]);
    vi.mocked(api.putOpen).mockImplementation(async (active) => ({ openProjectIds: ['a', 'b'], activeProjectId: active, version: 1 }));
  });
  afterEach(() => vi.clearAllMocks());

  it('activate só envia o projeto ativo (nunca uma lista que feche projetos)', async () => {
    await useApp.getState().activate('a');
    expect(api.putOpen).toHaveBeenCalledWith('a');
    expect(api.closeProject).not.toHaveBeenCalled();
  });

  it('openProject usa a rota de abrir; closeProject a de fechar', async () => {
    vi.mocked(api.openProject).mockResolvedValue({ openProjectIds: ['a', 'b'], activeProjectId: 'b', version: 1 });
    await useApp.getState().openProject('b');
    expect(api.openProject).toHaveBeenCalledWith('b');
    expect(useApp.getState().openIds).toEqual(['a', 'b']);
    expect(useApp.getState().activeId).toBe('b');
    vi.mocked(api.closeProject).mockResolvedValue({ openProjectIds: ['a'], activeProjectId: 'a', version: 2 });
    await useApp.getState().closeProject('b');
    expect(api.closeProject).toHaveBeenCalledWith('b');
    expect(useApp.getState().openIds).toEqual(['a']);
    expect(useApp.getState().activeId).toBe('a');
    expect(api.putOpen).not.toHaveBeenCalled();
  });

  it('open-changed de outra janela atualiza as abas e carrega sessões do projeto novo', async () => {
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['a', 'c'], activeProjectId: 'c', version: 1 });
    expect(useApp.getState().openIds).toEqual(['a', 'c']);
    // A janela mantém o próprio ativo enquanto ele seguir aberto.
    expect(useApp.getState().activeId).toBe('a');
    await vi.waitFor(() => expect(api.sessions).toHaveBeenCalledWith('c'));
    // Ativo fechado em outra janela: adota o ativo do servidor.
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['c'], activeProjectId: 'c', version: 2 });
    expect(useApp.getState().activeId).toBe('c');
  });

  it('open-changed antigo chegando durante openProject não tira a aba nem troca o ativo', async () => {
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['a'], activeProjectId: 'a', version: 5 });
    let resolve!: (o: { openProjectIds: string[]; activeProjectId: string; version: number }) => void;
    vi.mocked(api.openProject).mockReturnValue(new Promise((r) => (resolve = r)));
    const p = useApp.getState().openProject('b');
    expect(useApp.getState().openIds).toEqual(['a', 'b']);
    // Evento de uma mudança anterior (outra janela ativou 'a') chega antes da resposta.
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['a'], activeProjectId: 'a', version: 6 });
    expect(useApp.getState().openIds).toEqual(['a', 'b']);
    expect(useApp.getState().activeId).toBe('b');
    resolve({ openProjectIds: ['a', 'b'], activeProjectId: 'b', version: 7 });
    await p;
    expect(useApp.getState().openIds).toEqual(['a', 'b']);
    expect(useApp.getState().activeId).toBe('b');
    // O próprio evento da abertura (mesma versão) chega depois: nada muda.
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['a', 'b'], activeProjectId: 'b', version: 7 });
    expect(useApp.getState().activeId).toBe('b');
  });

  it('evento mais novo que a resposta, recebido durante o pedido, vence', async () => {
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['a'], activeProjectId: 'a', version: 10 });
    let resolve!: (o: { openProjectIds: string[]; activeProjectId: string; version: number }) => void;
    vi.mocked(api.openProject).mockReturnValue(new Promise((r) => (resolve = r)));
    const p = useApp.getState().openProject('b');
    // Outra janela abriu 'c' depois da nossa abertura (versão 12 > resposta 11).
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['a', 'b', 'c'], activeProjectId: 'c', version: 12 });
    resolve({ openProjectIds: ['a', 'b'], activeProjectId: 'b', version: 11 });
    await p;
    expect(useApp.getState().openIds).toEqual(['a', 'b', 'c']);
    expect(useApp.getState().activeId).toBe('b');
  });

  it('versão antiga é ignorada fora de pedidos', () => {
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['a', 'b'], activeProjectId: 'a', version: 20 });
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['a'], activeProjectId: 'a', version: 19 });
    expect(useApp.getState().openIds).toEqual(['a', 'b']);
  });

  it('open-changed com projeto desconhecido recarrega a lista de projetos', async () => {
    useApp.getState().applyEvent({ type: 'open-changed', openProjectIds: ['a', 'novo'], activeProjectId: 'a', version: 1 });
    await vi.waitFor(() => expect(api.projects).toHaveBeenCalled());
  });
});
