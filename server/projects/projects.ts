import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Store } from '../store/store.js';
import type { Runner } from '../env/exec.js';
import type { GitHub } from '../github/gh.js';
import type { Config } from '../config.js';
import { Git } from '../git/git.js';
import { joinEnvPath } from '../env/paths.js';
import type { EnvId, Project, ProjectView } from '../types.js';

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

type GithubOpt = false | { owner?: string; private: boolean };

const GITIGNORE = 'node_modules/\ndist/\n.env\n';

export interface ProjectServiceDeps {
  store: Store;
  run: Runner;
  github: GitHub;
  config: Config;
}

export class ProjectService {
  private readonly store: Store;
  private readonly run: Runner;
  private readonly github: GitHub;
  private readonly homes = new Map<EnvId, string>();

  constructor(deps: ProjectServiceDeps) {
    this.store = deps.store;
    this.run = deps.run;
    this.github = deps.github;
  }

  private async home(env: EnvId): Promise<string> {
    let h = this.homes.get(env);
    if (!h) {
      const r = await this.run(env, null, 'bash', ['-lc', 'printf %s "$HOME"']);
      if (r.code !== 0 || !r.stdout.trim()) throw new ProjectError(r.stderr.trim() || 'não foi possível descobrir a pasta home no WSL');
      h = r.stdout.trim();
      this.homes.set(env, h);
    }
    return h;
  }

  /** Em WSL troca `~` inicial pela home absoluta; no Windows devolve como veio. */
  private async resolve(env: EnvId, p: string): Promise<string> {
    if (env === 'windows' || !/^~(\/|$)/.test(p)) return p;
    return (await this.home(env)) + p.slice(1);
  }

  private async dirExists(env: EnvId, path: string): Promise<boolean> {
    if (env === 'windows') {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    }
    return (await this.run(env, null, 'test', ['-d', path])).code === 0;
  }

  private async fileExists(env: EnvId, path: string): Promise<boolean> {
    if (env === 'windows') return existsSync(path);
    return (await this.run(env, null, 'test', ['-e', path])).code === 0;
  }

  private async mkdirp(env: EnvId, path: string): Promise<void> {
    if (env === 'windows') {
      await mkdir(path, { recursive: true });
      return;
    }
    const r = await this.run(env, null, 'mkdir', ['-p', '--', path]);
    if (r.code !== 0) throw new ProjectError(r.stderr.trim() || `não foi possível criar ${path}`);
  }

  private async writeFileIn(env: EnvId, file: string, content: string): Promise<void> {
    if (env === 'windows') {
      await writeFile(file, content, 'utf8');
      return;
    }
    const r = await this.run(env, null, 'sh', ['-c', 'cat > "$1"', 'sh', file], { input: content });
    if (r.code !== 0) throw new ProjectError(r.stderr.trim() || `não foi possível escrever ${file}`);
  }

  private basename(p: string): string {
    return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
  }

  private assertUnique(env: EnvId, name: string, path: string): void {
    const dup = this.store.get().projects.find((p) => p.env === env && (p.name === name || p.path === path));
    if (dup) throw new ProjectError(`já existe um projeto "${dup.name}" neste ambiente`);
  }

  private add(project: Project): void {
    this.store.update((s) => {
      s.projects.push(project);
    });
  }

  private async attachRemote(project: Project, github: Exclude<GithubOpt, false>): Promise<void> {
    const url = await this.github.createRepo(project.env, project.path, {
      ...(github.owner ? { owner: github.owner } : {}),
      name: project.name,
      private: github.private,
    });
    this.store.update(() => {
      project.remoteUrl = url;
    });
  }

  async list(): Promise<ProjectView[]> {
    return Promise.all(
      this.store.get().projects.map(async (p) => ({ ...p, missing: !(await this.dirExists(p.env, p.path)) })),
    );
  }

  async create(input: { env: EnvId; name: string; baseDir: string; github: GithubOpt }): Promise<{ project: Project; warnings: string[] }> {
    const { env, name } = input;
    if (!name.trim() || /[\\/]/.test(name)) throw new ProjectError('nome de projeto inválido');
    const base = await this.resolve(env, input.baseDir);
    const path = joinEnvPath(env, base, name);
    this.assertUnique(env, name, path);
    if (await this.fileExists(env, path)) throw new ProjectError(`a pasta já existe: ${path}`);

    await this.mkdirp(env, path);
    const git = new Git(this.run, env, path);
    await git.init();
    await this.writeFileIn(env, joinEnvPath(env, path, 'README.md'), `# ${name}\n`);
    await this.writeFileIn(env, joinEnvPath(env, path, '.gitignore'), GITIGNORE);
    await git.commit(['README.md', '.gitignore'], 'chore: início do projeto');

    const project: Project = { id: randomUUID(), name, env, path, createdAt: new Date().toISOString() };
    this.add(project);
    const warnings: string[] = [];
    if (input.github) {
      try {
        await this.attachRemote(project, input.github);
        await git.push();
      } catch (e) {
        warnings.push(`github-falhou: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { project, warnings };
  }

  async register(input: { env: EnvId; path: string; github: GithubOpt }): Promise<{ project: Project; warnings: string[] }> {
    const { env } = input;
    const path = (await this.resolve(env, input.path)).replace(/[\\/]+$/, '');
    if (!(await this.dirExists(env, path))) throw new ProjectError(`pasta não encontrada: ${path}`);
    const name = this.basename(path);
    this.assertUnique(env, name, path);

    const git = new Git(this.run, env, path);
    const project: Project = { id: randomUUID(), name, env, path, createdAt: new Date().toISOString() };
    const warnings: string[] = [];
    if (await git.isRepo()) {
      const r = await this.run(env, path, 'git', ['remote', 'get-url', 'origin']);
      if (r.code === 0 && r.stdout.trim()) project.remoteUrl = r.stdout.trim();
      this.add(project);
      if (!project.remoteUrl && input.github) await this.attachRemote(project, input.github);
    } else {
      await git.init();
      this.add(project);
      if (input.github) await this.attachRemote(project, input.github);
    }
    if (!(await this.fileExists(env, joinEnvPath(env, path, '.gitignore')))) warnings.push('sem-gitignore');
    return { project, warnings };
  }

  async createGitignore(id: string): Promise<void> {
    const p = this.store.get().projects.find((x) => x.id === id);
    if (!p) throw new ProjectError('projeto não encontrado');
    const file = joinEnvPath(p.env, p.path, '.gitignore');
    if (await this.fileExists(p.env, file)) return;
    await this.writeFileIn(p.env, file, GITIGNORE);
  }

  remove(id: string): void {
    this.store.update((s) => {
      s.projects = s.projects.filter((p) => p.id !== id);
      s.openProjectIds = s.openProjectIds.filter((x) => x !== id);
      if (s.activeProjectId === id) delete s.activeProjectId;
    });
  }
}
