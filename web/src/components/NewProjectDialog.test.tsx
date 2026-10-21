// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  ApiError: class ApiError extends Error {
    constructor(m: string, public status: number, public body: Record<string, unknown> = {}) { super(m); }
  },
  api: {
    environments: vi.fn(),
    ghStatus: vi.fn(),
    createProject: vi.fn(),
    registerProject: vi.fn(),
    createGitignore: vi.fn(),
  },
}));

import { api, ApiError } from '../api';
import { NewProjectDialog } from './NewProjectDialog';

const tools = (env: string, gh: boolean) => ({ env, git: true, claude: true, gh, ghLoggedIn: gh });
const envs = {
  envs: [tools('windows', false), tools('wsl:Ubuntu', false)],
  roots: { windows: 'C:\GIT', wsl: '~/git' },
  hints: { claude: { windows: 'irm x | iex', wsl: 'curl x' }, gh: { windows: 'winget install GitHub.cli', wsl: 'sudo apt install gh' } },
};

describe('NewProjectDialog', () => {
  beforeEach(() => {
    vi.mocked(api.environments).mockResolvedValue(envs as never);
  });
  afterEach(() => cleanup());

  it('caixa do GitHub começa marcada quando gh está pronto', async () => {
    vi.mocked(api.ghStatus).mockResolvedValue({ installed: true, loggedIn: true, user: 'afonso', orgs: ['acme'] });
    render(<NewProjectDialog onClose={() => {}} onCreated={() => {}} />);
    const box = await screen.findByLabelText(/Criar repositório no GitHub/);
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));
    expect(await screen.findByDisplayValue('C:\GIT')).toBeTruthy();
  });

  it('com gh ausente desmarca e mostra a dica', async () => {
    vi.mocked(api.ghStatus).mockResolvedValue({ installed: false, loggedIn: false, user: null, orgs: [] });
    render(<NewProjectDialog onClose={() => {}} onCreated={() => {}} />);
    expect(await screen.findByText(/winget install GitHub\.cli/)).toBeTruthy();
    const box = screen.getByLabelText(/Criar repositório no GitHub/) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByText(/gh auth login/)).toBeTruthy();
    expect(screen.getByText(/reinicie o portal depois/)).toBeTruthy();
  });

  const fillAndSubmit = async () => {
    const name = await screen.findByLabelText('Nome');
    fireEvent.change(name, { target: { value: 'novo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
  };

  it('409 git-identidade mostra a mensagem do servidor', async () => {
    vi.mocked(api.ghStatus).mockResolvedValue({ installed: false, loggedIn: false, user: null, orgs: [] });
    const msg = 'Configure git user.name e user.email no Windows: git config --global user.name "Seu Nome" && git config --global user.email voce@exemplo.com';
    vi.mocked(api.createProject).mockRejectedValue(new ApiError(msg, 409, { erro: 'git-identidade', mensagem: msg }));
    render(<NewProjectDialog onClose={() => {}} onCreated={() => {}} />);
    await fillAndSubmit();
    expect(await screen.findByText(msg)).toBeTruthy();
  });

  it('aviso commit-inicial-falhou aparece na tela de resultado', async () => {
    vi.mocked(api.ghStatus).mockResolvedValue({ installed: false, loggedIn: false, user: null, orgs: [] });
    vi.mocked(api.createProject).mockResolvedValue({
      project: { id: 'x', name: 'novo', env: 'windows', path: 'C:/GIT/novo', createdAt: '' },
      warnings: ['commit-inicial-falhou: hook recusou'],
    });
    render(<NewProjectDialog onClose={() => {}} onCreated={() => {}} />);
    await fillAndSubmit();
    expect(await screen.findByText(/commit inicial.*hook recusou/i)).toBeTruthy();
  });

  it('clique fora não fecha enquanto está criando', async () => {
    vi.mocked(api.ghStatus).mockResolvedValue({ installed: false, loggedIn: false, user: null, orgs: [] });
    vi.mocked(api.createProject).mockReturnValue(new Promise(() => {}));
    const onClose = vi.fn();
    const { container } = render(<NewProjectDialog onClose={onClose} onCreated={() => {}} />);
    await fillAndSubmit();
    await screen.findByText('Criando…');
    fireEvent.mouseDown(container.querySelector('.overlay')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
