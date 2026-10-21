import { execFile } from 'node:child_process';
import type { EnvId, EnvTools } from '../types.js';
import { runIn, type Runner } from './exec.js';

export const INSTALL_HINTS: Record<'claude' | 'gh', { windows: string; wsl: string }> = {
  claude: { windows: 'irm https://claude.ai/install.ps1 | iex', wsl: 'curl -fsSL https://claude.ai/install.sh | bash' },
  gh: { windows: 'winget install GitHub.cli', wsl: 'sudo apt install gh' },
};

export function parseDistros(raw: Buffer): string[] {
  return raw
    .toString('utf16le')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('docker-desktop'));
}

export function listEnvironments(): Promise<EnvId[]> {
  return new Promise((resolve) => {
    execFile('wsl.exe', ['-l', '-q'], { encoding: 'buffer', windowsHide: true }, (err, stdout) => {
      const distros = err ? [] : parseDistros(stdout);
      resolve(['windows', ...distros.map((d): EnvId => `wsl:${d}`)]);
    });
  });
}

export async function detectTools(env: EnvId, run: Runner = runIn): Promise<EnvTools> {
  const wsl = env !== 'windows';
  const has = async (tool: string): Promise<boolean> => {
    const r = wsl
      ? await run(env, null, 'bash', ['-lc', `command -v ${tool}`])
      : await run(env, null, tool, ['--version']);
    return r.code === 0;
  };
  const [git, claude, gh] = await Promise.all([has('git'), has('claude'), has('gh')]);
  let ghLoggedIn = false;
  if (gh) {
    const r = wsl
      ? await run(env, null, 'bash', ['-lc', 'gh auth status'])
      : await run(env, null, 'gh', ['auth', 'status']);
    ghLoggedIn = r.code === 0;
  }
  return { env, git, claude, gh, ghLoggedIn };
}
