import { execFile } from 'node:child_process';
import type { EnvId, ExecResult } from '../types.js';

export type Runner = (
  env: EnvId,
  cwd: string | null,
  cmd: string,
  args: string[],
  opts?: { input?: string; timeoutMs?: number },
) => Promise<ExecResult>;

export const runIn: Runner = (env, cwd, cmd, args, opts) =>
  new Promise((resolve) => {
    let file = cmd;
    let fileArgs = args;
    let execCwd: string | undefined = cwd ?? undefined;
    if (env !== 'windows') {
      const distro = env.slice('wsl:'.length);
      file = 'wsl.exe';
      fileArgs = ['-d', distro, ...(cwd ? ['--cd', cwd] : []), '-e', cmd, ...args];
      execCwd = undefined;
    }
    const child = execFile(
      file,
      fileArgs,
      { cwd: execCwd, shell: false, encoding: 'utf8', windowsHide: true, timeout: opts?.timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout, stderr });
        const e = err as NodeJS.ErrnoException & { code?: number | string };
        if (typeof e.code === 'number') return resolve({ code: e.code, stdout, stderr });
        resolve({ code: 1, stdout: stdout ?? '', stderr: stderr || e.message });
      },
    );
    if (opts?.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
