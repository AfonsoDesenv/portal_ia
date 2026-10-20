import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { toWslPath } from '../server/env/paths.js';
import { runIn, type Runner } from '../server/env/exec.js';
import { parseDistros, detectTools, INSTALL_HINTS } from '../server/env/environments.js';

let hasWsl = false;
try {
  const out = execFileSync('wsl.exe', ['-l', '-q']);
  hasWsl = parseDistros(out).includes('Ubuntu');
} catch { hasWsl = false; }

describe('paths', () => {
  it('converte caminhos Windows para WSL', () => {
    expect(toWslPath('C:\\GIT\\meu projeto')).toBe('/mnt/c/GIT/meu projeto');
    expect(toWslPath('D:\\x')).toBe('/mnt/d/x');
  });
});

describe('parseDistros', () => {
  it('ignora docker-desktop', () => {
    expect(parseDistros(Buffer.from('Ubuntu\r\ndocker-desktop\r\ndocker-desktop-data\r\n', 'utf16le'))).toEqual(['Ubuntu']);
  });
});

describe('runIn', () => {
  it('windows: argumentos com espaço sem shell', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'portal-'));
    const r = await runIn('windows', tmp, 'git', ['init', 'pasta com espaço']);
    expect(r.code).toBe(0);
    expect(existsSync(join(tmp, 'pasta com espaço', '.git'))).toBe(true);
  });
  it('código não-zero não lança', async () => {
    const r = await runIn('windows', null, 'git', ['--naoexiste']);
    expect(r.code).not.toBe(0);
  });
  it('comando inexistente resolve com código != 0', async () => {
    const r = await runIn('windows', null, 'comando-que-nao-existe-xyz', []);
    expect(r.code).not.toBe(0);
    expect(r.stderr).not.toBe('');
  });
  it.skipIf(!hasWsl)('wsl: echo com acento', async () => {
    const r = await runIn('wsl:Ubuntu', null, 'echo', ['ação']);
    expect(r.stdout).toBe('ação\n');
  }, 60000);
  it.skipIf(!hasWsl)('wsl: argv literal (espaço, $, aspas) sem re-parse de shell', async () => {
    const r = await runIn('wsl:Ubuntu', null, 'printf', ['%s|', 'a b', 'c$HOME', "d'e"]);
    expect(r.stdout).toBe("a b|c$HOME|d'e|");
  }, 60000);
});

describe('detectTools', () => {
  it('wsl com fake runner', async () => {
    const calls: string[][] = [];
    const fake: Runner = async (_e, _c, cmd, args) => {
      calls.push([cmd, ...args]);
      const s = [cmd, ...args].join(' ');
      if (s.includes('claude') || s.includes('gh')) return { code: 1, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const t = await detectTools('wsl:Ubuntu', fake);
    expect(t).toEqual({ env: 'wsl:Ubuntu', git: true, claude: false, gh: false, ghLoggedIn: false });
    expect(calls.some((c) => c[0] === 'bash' && c.includes('-lc'))).toBe(true);
  });
  it('windows: gh presente e logado', async () => {
    const fake: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const t = await detectTools('windows', fake);
    expect(t).toEqual({ env: 'windows', git: true, claude: true, gh: true, ghLoggedIn: true });
  });
  it('hints', () => {
    expect(INSTALL_HINTS.gh.windows).toBe('winget install GitHub.cli');
    expect(INSTALL_HINTS.gh.wsl).toBe('sudo apt install gh');
    expect(INSTALL_HINTS.claude.windows).toBe('irm https://claude.ai/install.ps1 | iex');
    expect(INSTALL_HINTS.claude.wsl).toBe('curl -fsSL https://claude.ai/install.sh | bash');
  });
});
