import { describe, it, expect } from 'vitest';
import { GitHub } from '../server/github/gh.js';
import type { Runner } from '../server/env/exec.js';
import type { EnvId, ExecResult } from '../server/types.js';

type Call = { env: EnvId; cwd: string | null; cmd: string; args: string[] };

function fakeRunner(script: (call: Call) => ExecResult) {
  const calls: Call[] = [];
  const run: Runner = async (env, cwd, cmd, args) => {
    const call = { env, cwd, cmd, args };
    calls.push(call);
    return script(call);
  };
  return { run, calls };
}

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });
const fail = (stderr = 'erro', code = 1): ExecResult => ({ code, stdout: '', stderr });

describe('GitHub.createRepo', () => {
  it('cria repositório privado no usuário e devolve a URL do origin', async () => {
    const { run, calls } = fakeRunner((c) =>
      c.cmd === 'git' ? ok('https://github.com/afonso/x.git\n') : ok(),
    );
    const gh = new GitHub(run);
    const url = await gh.createRepo('windows', 'C:\\GIT\\x', { name: 'x', private: true });

    expect(calls[0]).toEqual({
      env: 'windows',
      cwd: 'C:\\GIT\\x',
      cmd: 'gh',
      args: ['repo', 'create', 'x', '--private', '--source', '.', '--remote', 'origin'],
    });
    expect(calls[1]).toEqual({
      env: 'windows',
      cwd: 'C:\\GIT\\x',
      cmd: 'git',
      args: ['remote', 'get-url', 'origin'],
    });
    expect(url).toBe('https://github.com/afonso/x.git');
  });

  it('usa owner/name quando owner é informado e --public quando não privado', async () => {
    const { run, calls } = fakeRunner((c) => (c.cmd === 'git' ? ok('u\n') : ok()));
    const gh = new GitHub(run);
    await gh.createRepo('wsl:Ubuntu', '/home/u/x', { owner: 'minha-org', name: 'x', private: false });

    expect(calls[0].args).toEqual([
      'repo', 'create', 'minha-org/x', '--public', '--source', '.', '--remote', 'origin',
    ]);
    expect(calls[0].env).toBe('wsl:Ubuntu');
  });

  it('lança erro com o stderr do gh quando a criação falha', async () => {
    const { run, calls } = fakeRunner(() => fail('name already exists on this account'));
    const gh = new GitHub(run);
    await expect(
      gh.createRepo('windows', 'C:\\GIT\\x', { name: 'x', private: true }),
    ).rejects.toThrow('name already exists on this account');
    expect(calls).toHaveLength(1);
  });
});

describe('GitHub.status', () => {
  it('gh --version falha → não instalado e não logado', async () => {
    const { run, calls } = fakeRunner(() => fail('not found', 127));
    const gh = new GitHub(run);
    expect(await gh.status('windows')).toEqual({ installed: false, loggedIn: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ env: 'windows', cwd: null, cmd: 'gh', args: ['--version'] });
  });

  it('instalado e logado → devolve o login do usuário', async () => {
    const { run, calls } = fakeRunner((c) => {
      if (c.args[0] === '--version') return ok('gh version 2.0');
      if (c.args[0] === 'auth') return ok();
      if (c.args[0] === 'api') return ok('afonso\n');
      return fail();
    });
    const gh = new GitHub(run);
    expect(await gh.status('windows')).toEqual({ installed: true, loggedIn: true, user: 'afonso' });
    expect(calls[2].args).toEqual(['api', 'user', '--jq', '.login']);
  });

  it('instalado mas não logado → não consulta o usuário', async () => {
    const { run, calls } = fakeRunner((c) => (c.args[0] === 'auth' ? fail() : ok()));
    const gh = new GitHub(run);
    expect(await gh.status('windows')).toEqual({ installed: true, loggedIn: false });
    expect(calls.some((c) => c.args[0] === 'api')).toBe(false);
  });
});

describe('GitHub.orgs', () => {
  it('lista organizações ignorando linhas vazias', async () => {
    const { run, calls } = fakeRunner(() => ok('org-a\n\norg-b\n'));
    const gh = new GitHub(run);
    expect(await gh.orgs('windows')).toEqual(['org-a', 'org-b']);
    expect(calls[0]).toEqual({
      env: 'windows',
      cwd: null,
      cmd: 'gh',
      args: ['api', 'user/orgs', '--jq', '.[].login'],
    });
  });
});
