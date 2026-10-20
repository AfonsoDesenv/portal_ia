// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', () => ({
  api: { gitStatus: vi.fn(), commit: vi.fn() },
  ApiError: class ApiError extends Error {
    constructor(m: string, public status: number, public body: Record<string, unknown> = {}) { super(m); }
  },
}));

import { api, ApiError } from '../api';
import { useApp } from '../store';
import { ChangesPanel } from './ChangesPanel';

const f = (path: string, extra: object = {}) => ({ path, index: ' ', worktree: 'M', added: 1, removed: 2, binary: false, ...extra });

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('ChangesPanel', () => {
  beforeEach(() => {
    useApp.setState({ selection: {}, draft: {}, activeId: 'p1', gitTick: {}, mode: {} });
    vi.mocked(api.gitStatus).mockResolvedValue({ branch: 'main', files: [f('app.ts'), f('.env'), f('README.md')] });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('.env começa desmarcado e os outros marcados', async () => {
    render(<ChangesPanel projectId="p1" compact={false} />);
    await screen.findByText('app.ts');
    expect(box('app.ts').checked).toBe(true);
    expect(box('README.md').checked).toBe(true);
    expect(box('.env').checked).toBe(false);
  });

  it('botões desabilitados sem mensagem; habilitam com mensagem', async () => {
    render(<ChangesPanel projectId="p1" compact={false} />);
    await screen.findByText('app.ts');
    const commit = screen.getByRole('button', { name: 'Commit' }) as HTMLButtonElement;
    const push = screen.getByRole('button', { name: 'Commit + Push' }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    expect(push.disabled).toBe(true);
    await userEvent.type(screen.getByPlaceholderText('Mensagem do commit'), 'ajuste');
    expect(commit.disabled).toBe(false);
    expect(push.disabled).toBe(false);
  });

  it('sem arquivo marcado os botões ficam desabilitados', async () => {
    render(<ChangesPanel projectId="p1" compact={false} />);
    await screen.findByText('app.ts');
    await userEvent.type(screen.getByPlaceholderText('Mensagem do commit'), 'x');
    await userEvent.click(box('app.ts'));
    await userEvent.click(box('README.md'));
    expect((screen.getByRole('button', { name: 'Commit' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Commit + Push envia só os marcados', async () => {
    vi.mocked(api.commit).mockResolvedValue({ hash: 'abcdef123456', pushed: true });
    render(<ChangesPanel projectId="p1" compact={false} />);
    await screen.findByText('app.ts');
    await userEvent.type(screen.getByPlaceholderText('Mensagem do commit'), 'minha msg');
    await userEvent.click(screen.getByRole('button', { name: 'Commit + Push' }));
    await waitFor(() =>
      expect(api.commit).toHaveBeenCalledWith('p1', { files: ['app.ts', 'README.md'], message: 'minha msg', push: true }));
    expect(await screen.findByText('Commit feito e enviado')).toBeTruthy();
    expect((screen.getByPlaceholderText('Mensagem do commit') as HTMLTextAreaElement).value).toBe('');
  });

  it('push que falhou mostra o aviso', async () => {
    vi.mocked(api.commit).mockResolvedValue({ hash: 'abcdef123456', pushed: false, erroPush: 'projeto sem remoto' });
    render(<ChangesPanel projectId="p1" compact={false} />);
    await screen.findByText('app.ts');
    await userEvent.type(screen.getByPlaceholderText('Mensagem do commit'), 'm');
    await userEvent.click(screen.getByRole('button', { name: 'Commit + Push' }));
    expect(await screen.findByText('Commit feito. Push falhou: projeto sem remoto')).toBeTruthy();
  });

  it('409 mostra a mensagem e mantém mensagem e seleção', async () => {
    vi.mocked(api.commit).mockRejectedValue(new ApiError('hook recusou', 409, { erro: 'git', mensagem: 'hook recusou' }));
    render(<ChangesPanel projectId="p1" compact={false} />);
    await screen.findByText('app.ts');
    await userEvent.type(screen.getByPlaceholderText('Mensagem do commit'), 'm');
    await userEvent.click(screen.getByRole('button', { name: 'Commit' }));
    expect(await screen.findByText('hook recusou')).toBeTruthy();
    expect((screen.getByPlaceholderText('Mensagem do commit') as HTMLTextAreaElement).value).toBe('m');
    expect(box('app.ts').checked).toBe(true);
  });

  it('arquivo renomeado marcado envia path e oldPath', async () => {
    vi.mocked(api.gitStatus).mockResolvedValue({ branch: 'main', files: [f('novo.ts', { oldPath: 'velho.ts', index: 'R' })] });
    vi.mocked(api.commit).mockResolvedValue({ hash: 'abcdef123456', pushed: false });
    render(<ChangesPanel projectId="p1" compact={false} />);
    await screen.findByText(/novo\.ts/);
    await userEvent.type(screen.getByPlaceholderText('Mensagem do commit'), 'renomeia');
    await userEvent.click(screen.getByRole('button', { name: 'Commit' }));
    await waitFor(() =>
      expect(api.commit).toHaveBeenCalledWith('p1', { files: ['novo.ts', 'velho.ts'], message: 'renomeia', push: false }));
  });

  it('seleção do usuário sobrevive a novo status; arquivos novos usam o padrão', async () => {
    render(<ChangesPanel projectId="p1" compact={false} />);
    await screen.findByText('app.ts');
    await userEvent.click(box('app.ts'));
    vi.mocked(api.gitStatus).mockResolvedValue({ branch: 'main', files: [f('app.ts'), f('.env.local'), f('novo.md')] });
    useApp.setState({ gitTick: { p1: 1 } });
    await screen.findByText('novo.md');
    expect(box('app.ts').checked).toBe(false);
    expect(box('novo.md').checked).toBe(true);
    expect(box('.env.local').checked).toBe(false);
  });
});
