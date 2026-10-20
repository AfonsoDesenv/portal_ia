import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    const p = await svc.create({ env: 'windows', name: 'meu projeto', baseDir: dir, github: false });
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
    const p = await s.create({ env: 'windows', name: 'com gh', baseDir: dir, github: { private: true } });
    expect(withRemote.mock.calls[0][2]).toMatchObject({ name: 'com gh', private: true });
    expect(p.remoteUrl).toBe('https://github.com/x/y.git');
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
    const p = await svc.create({ env: 'windows', name: 'x y', baseDir: dir, github: false });
    rmSync(p.path, { recursive: true, force: true });
    expect((await svc.list())[0].missing).toBe(true);
    const q = await svc.create({ env: 'windows', name: 'z w', baseDir: dir, github: false });
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
});
