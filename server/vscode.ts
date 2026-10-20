import { spawn } from 'node:child_process';
import type { Project } from './types.js';

export function buildVsCodeCommand(p: Project): { file: string; args: string[] } {
  if (p.env === 'windows') return { file: 'code', args: [p.path] };
  return { file: 'code', args: ['--remote', `wsl+${p.env.slice('wsl:'.length)}`, p.path] };
}

/** Aspas duplas para cmd.exe (spawn com shell:true concatena os args sem escapar). */
export function quoteForCmd(arg: string): string {
  if (/["%\r\n\0]/.test(arg)) throw new Error(`argumento inválido para o VS Code: ${arg}`);
  return `"${arg}"`;
}

export type SpawnFn = (
  file: string,
  args: string[],
  opts: { shell: boolean; detached: boolean; stdio: 'ignore' },
) => { unref(): void; on?(ev: 'error', cb: () => void): unknown };

export function launchVsCode(p: Project, spawnFn: SpawnFn = spawn as unknown as SpawnFn, win = process.platform === 'win32'): void {
  const { file, args } = buildVsCodeCommand(p);
  const child = spawnFn(file, win ? args.map(quoteForCmd) : args, { shell: win, detached: true, stdio: 'ignore' });
  child.on?.('error', () => {});
  child.unref();
}
