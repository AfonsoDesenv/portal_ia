import { execFileSync } from 'node:child_process';
import type { EnvId, SessionKind } from '../types.js';

export interface Launch {
  file: string;
  args: string[];
}

export interface LaunchParams {
  env: EnvId;
  cwd: string;
  kind: SessionKind;
  claudeArgs?: string[];
}

let cachedClaudePath: string | undefined;

/** Resolve (uma vez) o caminho do claude no Windows via `where.exe claude`. */
export function resolveWindowsClaude(): string {
  if (cachedClaudePath) return cachedClaudePath;
  const out = execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true });
  const first = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!first) throw new Error('claude não encontrado no Windows (where.exe claude)');
  cachedClaudePath = first;
  return first;
}

/** Função pura; `opts.claudePath` injeta o caminho do claude (testes), senão usa where.exe com cache. */
export function buildLaunch(p: LaunchParams, opts: { claudePath?: string } = {}): Launch {
  const claudeArgs = p.claudeArgs ?? [];
  if (p.env === 'windows') {
    if (p.kind === 'shell') return { file: 'powershell.exe', args: ['-NoLogo'] };
    return { file: opts.claudePath ?? resolveWindowsClaude(), args: [...claudeArgs] };
  }
  const distro = p.env.slice('wsl:'.length);
  const base = ['-d', distro, '--cd', p.cwd, '-e', 'bash'];
  if (p.kind === 'shell') return { file: 'wsl.exe', args: [...base, '-l'] };
  return { file: 'wsl.exe', args: [...base, '-lc', 'exec claude "$@"', 'claude', ...claudeArgs] };
}
