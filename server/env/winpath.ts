import { execFile } from 'node:child_process';

/**
 * Um processo recebe uma cópia do PATH quando nasce. Se o portal foi aberto por um terminal antigo,
 * ferramentas instaladas depois (gh, claude) ficam invisíveis. Aqui relemos o PATH de Máquina e de
 * Usuário do registro do Windows e atualizamos o do processo (e dos filhos que ele cria).
 */

const REFRESH_INTERVAL_MS = 10_000;

export interface RegistryPath { machine: string; user: string }

const key = (p: string) => p.trim().replace(/[\\/]+$/, '').toLowerCase();

/** Máquina, depois Usuário, depois o que só o processo tinha; sem vazios nem duplicados. */
export function mergeWindowsPath(current: string, machine: string, user: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of [machine, user, current].flatMap((s) => s.split(';'))) {
    const p = part.trim();
    if (!p || seen.has(key(p))) continue;
    seen.add(key(p));
    out.push(p);
  }
  return out.join(';');
}

/** Lê o PATH de Máquina e de Usuário (já com %VARIÁVEIS% expandidas) via PowerShell. */
export function readRegistryPath(): Promise<RegistryPath> {
  const script =
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
    "[Environment]::GetEnvironmentVariable('Path','Machine');" +
    "[Environment]::GetEnvironmentVariable('Path','User')";
  // Caminho completo: o PATH do processo pode ser justamente o que está desatualizado.
  const powershell = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  return new Promise((resolve, reject) => {
    execFile(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
      (err, stdout) => {
        if (err) return reject(err);
        const [machine = '', user = ''] = stdout.split(/\r?\n/);
        resolve({ machine, user });
      },
    );
  });
}

let lastAttempt = 0;
let inFlight: Promise<void> | null = null;

export function resetWindowsPathCache(): void {
  lastAttempt = 0;
  inFlight = null;
}

/** Atualiza `process.env.PATH` com o registro. No máximo uma leitura a cada 10 s; falhas são ignoradas. */
export function refreshWindowsPath(
  opts: { read?: () => Promise<RegistryPath>; platform?: NodeJS.Platform; now?: () => number } = {},
): Promise<void> {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return Promise.resolve();
  if (inFlight) return inFlight;
  const now = (opts.now ?? Date.now)();
  if (lastAttempt && now - lastAttempt < REFRESH_INTERVAL_MS) return Promise.resolve();
  lastAttempt = now;
  inFlight = (opts.read ?? readRegistryPath)()
    .then(({ machine, user }) => {
      if (!machine && !user) return;
      process.env.PATH = mergeWindowsPath(process.env.PATH ?? '', machine, user);
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
