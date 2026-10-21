import { afterEach, describe, expect, it } from 'vitest';
import { mergeWindowsPath, refreshWindowsPath, resetWindowsPathCache } from '../server/env/winpath.js';

describe('mergeWindowsPath', () => {
  it('põe Máquina e Usuário na frente e mantém extras do processo, sem duplicar', () => {
    const current = 'C:\\Windows;C:\\velho\\bin;C:\\Users\\a\\.local\\bin\\';
    const machine = 'C:\\Windows;C:\\Program Files\\GitHub CLI\\';
    const user = 'C:\\Users\\a\\.local\\bin;';
    expect(mergeWindowsPath(current, machine, user)).toBe(
      'C:\\Windows;C:\\Program Files\\GitHub CLI\\;C:\\Users\\a\\.local\\bin;C:\\velho\\bin',
    );
  });

  it('compara sem diferenciar maiúsculas e barra final', () => {
    expect(mergeWindowsPath('c:\\tools\\', 'C:\\Tools', '')).toBe('C:\\Tools');
  });
});

describe('refreshWindowsPath', () => {
  const saved = process.env.PATH;
  afterEach(() => {
    process.env.PATH = saved;
    resetWindowsPathCache();
  });

  it('atualiza o PATH do processo com o que está no registro (ferramenta instalada depois)', async () => {
    process.env.PATH = 'C:\\Windows';
    await refreshWindowsPath({
      read: async () => ({ machine: 'C:\\Windows;C:\\Program Files\\GitHub CLI\\', user: '' }),
      platform: 'win32',
    });
    expect(process.env.PATH).toBe('C:\\Windows;C:\\Program Files\\GitHub CLI\\');
  });

  it('relê no máximo uma vez por intervalo e não quebra se a leitura falhar', async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      throw new Error('sem powershell');
    };
    process.env.PATH = 'C:\\Windows';
    await refreshWindowsPath({ read, platform: 'win32' });
    await refreshWindowsPath({ read, platform: 'win32' });
    expect(calls).toBe(1);
    expect(process.env.PATH).toBe('C:\\Windows');
  });

  it('não faz nada fora do Windows', async () => {
    let calls = 0;
    await refreshWindowsPath({ read: async () => (calls++, { machine: 'x', user: '' }), platform: 'linux' });
    expect(calls).toBe(0);
  });
});

describe('runIn com PATH desatualizado', () => {
  const saved = process.env.PATH;
  afterEach(() => {
    process.env.PATH = saved;
    resetWindowsPathCache();
  });

  it.skipIf(process.platform !== 'win32')('acha uma ferramenta que só está no PATH do registro', async () => {
    const { runIn } = await import('../server/env/exec.js');
    process.env.PATH = 'C:\\Windows\\System32';
    resetWindowsPathCache();
    const r = await runIn('windows', null, 'git', ['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/git version/);
  }, 30_000);
});
