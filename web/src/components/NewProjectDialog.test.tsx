// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  api: {
    environments: vi.fn(),
    ghStatus: vi.fn(),
    createProject: vi.fn(),
    registerProject: vi.fn(),
    createGitignore: vi.fn(),
  },
}));

import { api } from '../api';
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
  });
});
