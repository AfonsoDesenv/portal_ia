import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  port: number;
  token: string;
  dataDir: string;
  tempDir: string;
  roots: { windows: string; wsl: string };
}

const DEFAULT_PORT = 4317;
const DEFAULT_ROOTS = { windows: 'C:\\GIT', wsl: '~/git' };

function defaultDataDir(): string {
  return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'portal-ia');
}

function defaultTempDir(): string {
  return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'portal-ia');
}

/**
 * Carrega (ou cria) config.json em `dir`. O token é gerado na primeira vez e persistido.
 * `tempDir` vale %LOCALAPPDATA%\portal-ia quando `dir` não é informado; com `dir` explícito
 * (testes) fica em `<dir>\tmp`, para não tocar fora do diretório informado.
 */
export function loadConfig(dir?: string): Config {
  const dataDir = dir ?? defaultDataDir();
  const tempDir = dir ? join(dir, 'tmp') : defaultTempDir();
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(tempDir, { recursive: true });

  const file = join(dataDir, 'config.json');
  let saved: Partial<Pick<Config, 'port' | 'token' | 'roots'>> = {};
  if (existsSync(file)) {
    saved = JSON.parse(readFileSync(file, 'utf8'));
  }

  const config: Config = {
    port: saved.port ?? DEFAULT_PORT,
    token: saved.token ?? randomBytes(32).toString('hex'),
    dataDir,
    tempDir,
    roots: { ...DEFAULT_ROOTS, ...saved.roots },
  };

  if (!saved.token) {
    const { port, token, roots } = config;
    writeFileSync(file, JSON.stringify({ port, token, roots }, null, 2));
  }
  return config;
}
