import { describe, it, expect } from 'vitest';
import { buildLaunch } from '../server/pty/launch.js';
import { PtyManager, SCROLLBACK_LIMIT } from '../server/pty/manager.js';

describe('buildLaunch', () => {
  it('windows/shell', () => {
    expect(buildLaunch({ env: 'windows', cwd: 'C:/GIT/x', kind: 'shell' })).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo'],
    });
  });
  it('windows/claude usa o caminho resolvido', () => {
    expect(
      buildLaunch(
        { env: 'windows', cwd: 'C:/GIT/x', kind: 'claude', claudeArgs: ['--resume', 'abc'] },
        { claudePath: 'C:/u/claude.exe' },
      ),
    ).toEqual({ file: 'C:/u/claude.exe', args: ['--resume', 'abc'] });
  });
  it('wsl/shell com espaço no cwd', () => {
    expect(buildLaunch({ env: 'wsl:Ubuntu', cwd: '/home/u/meu projeto', kind: 'shell' })).toEqual({
      file: 'wsl.exe',
      args: ['-d', 'Ubuntu', '--cd', '/home/u/meu projeto', '-e', 'bash', '-l'],
    });
  });
  it('wsl/claude passa args como posicionais', () => {
    expect(
      buildLaunch({ env: 'wsl:Ubuntu', cwd: '/home/u/meu projeto', kind: 'claude', claudeArgs: ['--resume', 'a b'] }),
    ).toEqual({
      file: 'wsl.exe',
      args: ['-d', 'Ubuntu', '--cd', '/home/u/meu projeto', '-e', 'bash', '-lc', 'exec claude "$@"', 'claude', '--resume', 'a b'],
    });
  });
});

const wait = (m: PtyManager) =>
  new Promise<{ id: string; code: number }>((res) => m.once('exit', (id, code) => res({ id, code })));

describe('PtyManager', () => {
  it('scrollback sobrevive ao fim do processo e emite exit 0', async () => {
    const m = new PtyManager();
    const exited = wait(m);
    m.spawn('a', { file: 'cmd.exe', args: ['/c', 'echo oi'] }, process.cwd());
    expect(await exited).toEqual({ id: 'a', code: 0 });
    expect(m.attach('a', () => {}).scrollback).toContain('oi');
    m.kill('a'); // no-op
  });

  it('killAll encerra os processos vivos', async () => {
    const m = new PtyManager();
    const exited = wait(m);
    m.spawn('k', { file: 'cmd.exe', args: ['/k'] }, process.cwd());
    expect(m.isAlive('k')).toBe(true);
    m.killAll();
    expect((await exited).id).toBe('k');
    expect(m.isAlive('k')).toBe(false);
  });

  it('attach recebe dados novos', async () => {
    const m = new PtyManager();
    const chunks: string[] = [];
    const exited = wait(m);
    m.spawn('b', { file: 'cmd.exe', args: ['/c', 'echo ola'] }, process.cwd());
    m.attach('b', (d) => chunks.push(d));
    await exited;
    expect(chunks.join('') + m.attach('b', () => {}).scrollback).toContain('ola');
  });

  it('limita scrollback a 2 MB mantendo o final', async () => {
    const m = new PtyManager();
    const exited = wait(m);
    m.spawn('c', { file: 'cmd.exe', args: ['/c', 'echo x'] }, process.cwd());
    await exited;
    const big = 'a'.repeat(SCROLLBACK_LIMIT);
    m.append('c', big);
    m.append('c', 'b'.repeat(1000) + 'FIM');
    const sb = m.attach('c', () => {}).scrollback;
    expect(sb.length).toBeLessThanOrEqual(SCROLLBACK_LIMIT);
    expect(sb.endsWith('bFIM')).toBe(true);
  });

  it('id desconhecido lança erro claro', () => {
    const m = new PtyManager();
    expect(() => m.write('x', 'a')).toThrow(/x/);
    expect(() => m.resize('x', 1, 1)).toThrow(/x/);
    expect(() => m.attach('x', () => {})).toThrow(/x/);
  });
});

describe('PtyManager respawn', () => {
  it('reiniciar um id encerrado mantém os listeners anexados', async () => {
    const m = new PtyManager();
    const chunks: string[] = [];
    let exited = wait(m);
    m.spawn('r', { file: 'cmd.exe', args: ['/c', 'echo primeiro'] }, process.cwd());
    m.attach('r', (d) => chunks.push(d));
    await exited;
    exited = wait(m);
    m.spawn('r', { file: 'cmd.exe', args: ['/c', 'echo segundo'] }, process.cwd());
    await exited;
    const all = chunks.join('');
    expect(all).toContain('primeiro');
    expect(all).toContain('segundo');
    const sb = m.attach('r', () => {}).scrollback;
    expect(sb).toContain('segundo');
    expect(sb).not.toContain('primeiro');
  });

  it('listener que lança não impede os demais', async () => {
    const m = new PtyManager();
    const chunks: string[] = [];
    const exited = wait(m);
    m.spawn('t', { file: 'cmd.exe', args: ['/c', 'echo ok'] }, process.cwd());
    m.attach('t', () => {
      throw new Error('boom');
    });
    m.attach('t', (d) => chunks.push(d));
    await exited;
    expect(chunks.join('')).toContain('ok');
  });

  it('spawn com processo vivo lança erro', async () => {
    const m = new PtyManager();
    m.spawn('v', { file: 'cmd.exe', args: ['/k'] }, process.cwd());
    expect(() => m.spawn('v', { file: 'cmd.exe', args: ['/c', 'x'] }, process.cwd())).toThrow(/v/);
    const exited = wait(m);
    m.kill('v');
    await exited;
  });
});
