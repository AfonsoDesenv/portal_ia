import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseDistros } from '../server/env/environments.js';
import { join } from 'node:path';
import { Store } from '../server/store/store.js';
import { runIn } from '../server/env/exec.js';
import { ProjectService, ProjectError } from '../server/projects/projects.js';
import type { GitHub } from '../server/github/gh.js';
import type { Config } from '../server/config.js';

let dir: string;
let store: Store;
let createRepo: ReturnType<typeof vi.fn>;
let svc: ProjectService;

beforeEach(() => {
  process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Teste';
  process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'teste@example.com';
  dir = mkdtempSync(join(tmpdir(), 'portal-proj-'));
  store = Store.open(join(dir, 'state.json'));
  createRepo = vi.fn(async () => 'https://github.com/x/y.git');
  const github = { createRepo } as unknown as GitHub;
  const config = { roots: { windows: dir, wsl: '~/git' } } as Config;
  svc = new ProjectService({ store, run: runIn, github, config });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) => runIn('windows', cwd, 'git', a);

describe('ProjectService', () => {
  it('create sem github: pasta, README, .gitignore, 1 commit, branch main', async () => {
    const { project: p } = await svc.create({ env: 'windows', name: 'meu projeto', baseDir: dir, github: false });
    expect(p.path).toBe(join(dir, 'meu projeto'));
    expect(readFileSync(join(p.path, 'README.md'), 'utf8')).toContain('# meu projeto');
    expect(readFileSync(join(p.path, '.gitignore'), 'utf8')).toContain('node_modules/');
    expect((await git(p.path, 'rev-list', '--count', 'HEAD')).stdout.trim()).toBe('1');
    expect((await git(p.path, 'symbolic-ref', '--short', 'HEAD')).stdout.trim()).toBe('main');
    expect((await git(p.path, 'log', '-1', '--format=%s')).stdout.trim()).toBe('chore: início do projeto');
    expect(store.get().projects).toHaveLength(1);
  });

  it('create com github chama createRepo privado e faz push', async () => {
    const withRemote = vi.fn(async (_e, cwd: string) => {
      const bare = join(dir, 'remote.git');
      await runIn('windows', null, 'git', ['init', '--bare', '-b', 'main', bare]);
      await runIn('windows', cwd, 'git', ['remote', 'add', 'origin', bare]);
      return 'https://github.com/x/y.git';
    });
    const s = new ProjectService({
      store, run: runIn, github: { createRepo: withRemote } as unknown as GitHub,
      config: { roots: { windows: dir, wsl: '~/git' } } as Config,
    });
    const { project: p } = await s.create({ env: 'windows', name: 'com gh', baseDir: dir, github: { private: true } });
    expect(withRemote.mock.calls[0][2]).toMatchObject({ name: 'com gh', private: true });
    expect(p.remoteUrl).toBe('https://github.com/x/y.git');
    expect(store.get().projects.find((x) => x.id === p.id)?.remoteUrl).toBe('https://github.com/x/y.git');
    const r = await git(join(dir, 'remote.git'), 'rev-list', '--count', 'main');
    expect(r.stdout.trim()).toBe('1');
  });

  it('create rejeita nome duplicado e pasta existente', async () => {
    await svc.create({ env: 'windows', name: 'a b', baseDir: dir, github: false });
    await expect(svc.create({ env: 'windows', name: 'a b', baseDir: dir, github: false })).rejects.toBeInstanceOf(ProjectError);
    mkdirSync(join(dir, 'existe'));
    await expect(svc.create({ env: 'windows', name: 'existe', baseDir: dir, github: false })).rejects.toBeInstanceOf(ProjectError);
  });

  it('register em pasta sem git: init sem commit e warning sem-gitignore', async () => {
    const d = join(dir, 'velha pasta');
    mkdirSync(d);
    writeFileSync(join(d, 'ação.md'), 'x');
    const { project, warnings } = await svc.register({ env: 'windows', path: d, github: false });
    expect(project.name).toBe('velha pasta');
    expect(warnings).toContain('sem-gitignore');
    expect((await git(d, 'rev-list', '--all')).stdout.trim()).toBe('');
    expect(existsSync(join(d, '.git'))).toBe(true);
  });

  it('register em repo existente lê remoteUrl; pasta inexistente gera ProjectError', async () => {
    const d = join(dir, 'repo');
    mkdirSync(d);
    await git(d, 'init', '-b', 'main');
    await git(d, 'remote', 'add', 'origin', 'https://example.com/r.git');
    const { project } = await svc.register({ env: 'windows', path: d, github: false });
    expect(project.remoteUrl).toBe('https://example.com/r.git');
    await expect(svc.register({ env: 'windows', path: join(dir, 'nada'), github: false })).rejects.toBeInstanceOf(ProjectError);
  });

  it('remove não apaga a pasta; list marca missing quando a pasta some', async () => {
    const { project: p } = await svc.create({ env: 'windows', name: 'x y', baseDir: dir, github: false });
    rmSync(p.path, { recursive: true, force: true });
    expect((await svc.list())[0].missing).toBe(true);
    const { project: q } = await svc.create({ env: 'windows', name: 'z w', baseDir: dir, github: false });
    expect((await svc.list()).find((v) => v.id === q.id)!.missing).toBe(false);
    store.update((s) => s.openProjectIds.push(q.id));
    svc.remove(q.id);
    expect(existsSync(q.path)).toBe(true);
    expect(store.get().projects.find((x) => x.id === q.id)).toBeUndefined();
    expect(store.get().openProjectIds).not.toContain(q.id);
  });

  it('createGitignore cria .gitignore', async () => {
    const d = join(dir, 'sem ign');
    mkdirSync(d);
    const { project } = await svc.register({ env: 'windows', path: d, github: false });
    await svc.createGitignore(project.id);
    expect(readFileSync(join(d, '.gitignore'), 'utf8')).toContain('.env');
  });

  it('create: falha do GitHub vira warning e o projeto fica registrado', async () => {
    const s = new ProjectService({
      store, run: runIn,
      github: { createRepo: async () => { throw new Error('sem rede'); } } as unknown as GitHub,
      config: { roots: { windows: dir, wsl: '~/git' } } as Config,
    });
    const { project, warnings } = await s.create({ env: 'windows', name: 'falha gh', baseDir: dir, github: { private: true } });
    expect(warnings).toEqual(['github-falhou: sem rede']);
    expect(store.get().projects.map((x) => x.id)).toContain(project.id);
    expect((await git(project.path, 'rev-list', '--count', 'HEAD')).stdout.trim()).toBe('1');
  });

  it('create sem identidade git: 409 git-identidade antes de criar qualquer coisa', async () => {
    const noIdent: typeof runIn = async (env, cwd, cmd, args, opts) => {
      if (cmd === 'git' && args[0] === 'var') return { code: 128, stdout: '', stderr: 'Author identity unknown' };
      return runIn(env, cwd, cmd, args, opts);
    };
    const s = new ProjectService({ store, run: noIdent, github: { createRepo } as unknown as GitHub, config: {} as Config });
    const p = s.create({ env: 'windows', name: 'sem ident', baseDir: dir, github: { private: true } });
    await expect(p).rejects.toMatchObject({ code: 'git-identidade' });
    await expect(p).rejects.toThrow(/Configure git user\.name e user\.email no Windows: git config --global user\.name "Seu Nome" && git config --global user\.email voce@exemplo\.com/);
    expect(existsSync(join(dir, 'sem ident'))).toBe(false);
    expect(createRepo).not.toHaveBeenCalled();
    expect(store.get().projects).toHaveLength(0);
  });

  it('create: commit inicial que falha mesmo assim registra o projeto com aviso', async () => {
    const failCommit: typeof runIn = async (env, cwd, cmd, args, opts) => {
      if (cmd === 'git' && args.includes('commit')) return { code: 1, stdout: '', stderr: 'hook recusou' };
      return runIn(env, cwd, cmd, args, opts);
    };
    const s = new ProjectService({ store, run: failCommit, github: { createRepo } as unknown as GitHub, config: {} as Config });
    const { project, warnings } = await s.create({ env: 'windows', name: 'falha commit', baseDir: dir, github: false });
    expect(warnings).toEqual(['commit-inicial-falhou: hook recusou']);
    expect(store.get().projects.map((x) => x.id)).toEqual([project.id]);
    expect(existsSync(join(project.path, 'README.md'))).toBe(true);
  });

  it('register: falha do GitHub vira warning github-falhou e o projeto fica registrado', async () => {
    const s = new ProjectService({
      store, run: runIn,
      github: { createRepo: async () => { throw new Error('sem rede'); } } as unknown as GitHub,
      config: {} as Config,
    });
    const d = join(dir, 'reg gh');
    mkdirSync(d);
    const { project, warnings } = await s.register({ env: 'windows', path: d, github: { private: true } });
    expect(warnings).toContain('github-falhou: sem rede');
    expect(store.get().projects.map((x) => x.id)).toContain(project.id);
    const d2 = join(dir, 'reg gh repo');
    mkdirSync(d2);
    await git(d2, 'init', '-b', 'main');
    const r2 = await s.register({ env: 'windows', path: d2, github: { private: true } });
    expect(r2.warnings).toContain('github-falhou: sem rede');
    expect(store.get().projects).toHaveLength(2);
  });

  it('ProjectError tem code: inválido, não encontrado, conflito', async () => {
    await expect(svc.create({ env: 'windows', name: 'a/b', baseDir: dir, github: false })).rejects.toMatchObject({ code: 'invalido' });
    await expect(svc.register({ env: 'windows', path: join(dir, 'nada'), github: false })).rejects.toMatchObject({ code: 'nao-encontrado' });
    await expect(svc.createGitignore('zz')).rejects.toMatchObject({ code: 'projeto-desconhecido' });
    mkdirSync(join(dir, 'existe'));
    await expect(svc.create({ env: 'windows', name: 'existe', baseDir: dir, github: false })).rejects.toMatchObject({ code: 'conflito' });
  });

  it('register em repo sem origin com github chama createRepo, sem commit', async () => {
    const d = join(dir, 'sem origin');
    mkdirSync(d);
    await git(d, 'init', '-b', 'main');
    const { project } = await svc.register({ env: 'windows', path: d, github: { private: true } });
    expect(createRepo).toHaveBeenCalledTimes(1);
    expect(project.remoteUrl).toBe('https://github.com/x/y.git');
    expect((await git(d, 'rev-list', '--all')).stdout.trim()).toBe('');
  });
});

let hasWsl = false;
try {
  hasWsl = parseDistros(execFileSync('wsl.exe', ['-l', '-q'])).includes('Ubuntu');
} catch { hasWsl = false; }

describe.skipIf(!hasWsl)('ProjectService em WSL', () => {
  it('cria pasta com espaço, README e list/missing', async () => {
    const tmp = `/tmp/portal-test-${Math.random().toString(36).slice(2)}`;
    const env = 'wsl:Ubuntu' as const;
    const s = new ProjectService({
      store, run: runIn, github: { createRepo } as unknown as GitHub,
      config: { roots: { windows: dir, wsl: '~/git' } } as Config,
    });
    try {
      const path = `${tmp}/meu projeto`;
      const ident = (await runIn(env, null, 'git', ['var', 'GIT_AUTHOR_IDENT'])).code === 0
        && (await runIn(env, null, 'git', ['var', 'GIT_COMMITTER_IDENT'])).code === 0;
      if (!ident) {
        // Sem identidade git no WSL: erro claro e nada é criado.
        await expect(s.create({ env, name: 'meu projeto', baseDir: tmp, github: false }))
          .rejects.toMatchObject({ code: 'git-identidade', message: expect.stringContaining('WSL (Ubuntu)') });
        expect((await runIn(env, null, 'test', ['-e', path])).code).not.toBe(0);
        return;
      }
      await s.create({ env, name: 'meu projeto', baseDir: tmp, github: false });
      expect((await runIn(env, null, 'test', ['-f', `${path}/README.md`])).code).toBe(0);
      expect((await runIn(env, null, 'test', ['-f', `${path}/.gitignore`])).code).toBe(0);
      expect((await s.list())[0].missing).toBe(false);
      await runIn(env, null, 'rm', ['-rf', '--', path]);
      expect((await s.list())[0].missing).toBe(true);
    } finally {
      await runIn(env, null, 'rm', ['-rf', '--', tmp]);
    }
  }, 120000);
});
