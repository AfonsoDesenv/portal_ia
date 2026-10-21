import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type Config } from '../server/config.js';
import { buildApp } from '../server/app.js';
import { Store } from '../server/store/store.js';
import { GitError } from '../server/git/git.js';
import { ProjectError } from '../server/projects/projects.js';
import { INSTALL_HINTS } from '../server/env/environments.js';
import { buildVsCodeCommand, launchVsCode } from '../server/vscode.js';
import type { EnvId, EnvTools, Project, ServerEvent } from '../server/types.js';

let dir: string;
let config: Config;
let store: Store;
let app: FastifyInstance;
let closed: string[];
let removed: string[];
let events: ServerEvent[];
let pushError: Error | null;
let commitError: Error | null;
let commits: { files: string[]; message: string }[];
let gitCalls: string[];
let launched: Project[];
let ghOrgsFail: boolean;
let projectsImpl: {
  create: (i: unknown) => Promise<unknown>;
  register: (i: unknown) => Promise<unknown>;
};

const proj: Project = { id: 'p1', name: 'x', env: 'windows', path: 'C:\\x', createdAt: '' };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portal-ia-routes-'));
  config = loadConfig(dir);
  store = Store.open(join(dir, 'state.json'));
  store.update((s) => {
    s.projects.push(proj);
    s.openProjectIds = ['p1', 'p2'];
  });
  closed = [];
  removed = [];
  events = [];
  pushError = null;
  commitError = null;
  commits = [];
  gitCalls = [];
  launched = [];
  ghOrgsFail = false;
  projectsImpl = {
    create: async () => ({ project: proj, warnings: ['github-falhou: x'] }),
    register: async () => {
      throw new ProjectError('pasta não encontrada: Z:\\n', 'nao-encontrado');
    },
  };
  app = buildApp({
    config,
    store,
    sessions: {
      closeProject: (id: string) => void closed.push(id),
      removeProject: (id: string) => void removed.push(id),
      emitEvent: (e: ServerEvent) => void events.push(e),
    } as never,
    projects: {
      list: async () => [{ ...proj, missing: false }],
      create: (i: unknown) => projectsImpl.create(i),
      register: (i: unknown) => projectsImpl.register(i),
      createGitignore: async () => {},
      remove: () => {},
    } as never,
    github: {
      status: async () => ({ installed: true, loggedIn: true, user: 'u' }),
      orgs: async () => {
        if (ghOrgsFail) throw new Error('boom');
        return ['org1'];
      },
    } as never,
    gitFor: () => ({
      status: async () => [],
      currentBranch: async () => 'main',
      branches: async () => ({ local: ['main'], remote: [] }),
      createBranch: async (n: string, f: string) => void gitCalls.push(`branch ${n} ${f}`),
      checkout: async (b: string) => {
        if (b === 'sujo') throw new GitError('suas alterações seriam sobrescritas');
        gitCalls.push(`checkout ${b}`);
      },
      fileVersions: async (p: string, old?: string) => {
        gitCalls.push(old ? `file ${p} <- ${old}` : `file ${p}`);
        return { original: '', modified: 'a', binary: false };
      },
      commit: async (files: string[], message: string) => {
        if (commitError) throw commitError;
        commits.push({ files, message });
        return 'abc123';
      },
      push: async () => {
        if (pushError) throw pushError;
      },
    }),
    listEnvs: async (): Promise<EnvId[]> => ['windows', 'wsl:Ubuntu'],
    detectTools: async (env: EnvId): Promise<EnvTools> => ({ env, git: true, claude: false, gh: false, ghLoggedIn: false }),
    launchVsCode: (p: Project) => void launched.push(p),
  });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const headers = () => ({ host: `localhost:${config.port}`, cookie: `portal_key=${config.token}` });
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: headers(), ...(payload !== undefined ? { payload: payload as object } : {}) });

describe('rotas de git', () => {
  it('commit com push falhando responde 200 com hash e erroPush', async () => {
    pushError = new GitError('projeto sem remoto');
    const r = await call('POST', '/api/projects/p1/git/commit', { files: ['a.txt'], message: 'feat: x', push: true });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ hash: 'abc123', pushed: false, erroPush: 'projeto sem remoto' });
    expect(commits[0].message).toBe('feat: x');
    expect(events).toContainEqual({ type: 'git-changed', projectId: 'p1' });
  });

  it('commit com push ok', async () => {
    const r = await call('POST', '/api/projects/p1/git/commit', { files: ['a.txt'], message: 'm', push: true });
    expect(r.json()).toEqual({ hash: 'abc123', pushed: true });
  });

  it('mensagem do commit passa sem alteração (sem trailer)', async () => {
    const message = 'feat: corpo\n\nlinha 2 do corpo';
    await call('POST', '/api/projects/p1/git/commit', { files: ['a.txt'], message, push: false });
    expect(commits[0].message).toBe(message);
    expect(commits[0].message).not.toMatch(/Co-Authored-By/i);
  });

  it('commit sem arquivos ou mensagem em branco é 400', async () => {
    expect((await call('POST', '/api/projects/p1/git/commit', { files: [], message: 'm', push: false })).statusCode).toBe(400);
    const r = await call('POST', '/api/projects/p1/git/commit', { files: ['a'], message: '  ', push: false });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBeTruthy();
    expect(r.json().mensagem).toBeTruthy();
  });

  it('GitError no commit é 409 com erro git', async () => {
    commitError = new GitError('nada a commitar');
    const r = await call('POST', '/api/projects/p1/git/commit', { files: ['a'], message: 'm', push: false });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ erro: 'git', mensagem: 'nada a commitar' });
  });

  it('GET git/file rejeita caminhos fora do projeto', async () => {
    for (const p of ['../x', 'a/../../x', '..\\x', 'a\\..\\..\\x', '/etc/passwd', 'C:\\x', '\\x', 'C:x']) {
      const r = await call('GET', `/api/projects/p1/git/file?path=${encodeURIComponent(p)}`);
      expect(r.statusCode, p).toBe(400);
      expect(r.json().erro).toBe('caminho-invalido');
    }
    expect(gitCalls).toEqual([]);
    const ok = await call('GET', `/api/projects/p1/git/file?path=${encodeURIComponent('src/ação.md')}`);
    expect(ok.statusCode).toBe(200);
    expect(gitCalls).toEqual(['file src/ação.md']);
  });

  it('GET git/file aceita oldPath (renomeação) validado', async () => {
    const q = (path: string, oldPath: string) =>
      call('GET', `/api/projects/p1/git/file?path=${encodeURIComponent(path)}&oldPath=${encodeURIComponent(oldPath)}`);
    expect((await q('novo.ts', '../fora')).statusCode).toBe(400);
    expect(gitCalls).toEqual([]);
    expect((await q('novo.ts', 'velho.ts')).statusCode).toBe(200);
    expect(gitCalls).toEqual(['file novo.ts <- velho.ts']);
  });

  it('criar branch emite git-changed; status e branches respondem', async () => {
    const r = await call('POST', '/api/projects/p1/git/branches', { name: 'feat', from: 'main' });
    expect(r.statusCode).toBe(200);
    expect(gitCalls).toEqual(['branch feat main']);
    expect(events).toContainEqual({ type: 'git-changed', projectId: 'p1' });
    expect((await call('GET', '/api/projects/p1/git/status')).json()).toEqual({ branch: 'main', files: [] });
    expect((await call('GET', '/api/projects/p1/git/branches')).json().local).toEqual(['main']);
  });

  it('checkout emite git-changed; erro do git vira 409 com a mensagem', async () => {
    const r = await call('POST', '/api/projects/p1/git/checkout', { branch: 'dev' });
    expect(r.statusCode).toBe(200);
    expect(gitCalls).toContain('checkout dev');
    expect(events).toContainEqual({ type: 'git-changed', projectId: 'p1' });
    const bad = await call('POST', '/api/projects/p1/git/checkout', { branch: 'sujo' });
    expect(bad.statusCode).toBe(409);
    expect(bad.json()).toMatchObject({ erro: 'git', mensagem: 'suas alterações seriam sobrescritas' });
    expect((await call('POST', '/api/projects/p1/git/checkout', { branch: '-f' })).statusCode).toBe(400);
  });

  it('projeto desconhecido é 404', async () => {
    const r = await call('GET', '/api/projects/nope/git/status');
    expect(r.statusCode).toBe(404);
    expect(r.json().erro).toBe('projeto-desconhecido');
  });
});

describe('rotas de projetos e ambiente', () => {
  const p2: Project = { ...proj, id: 'p2', path: 'D:/y' };
  const openChanged = () => events.filter((e) => e.type === 'open-changed');

  it('PUT /api/open só troca o ativo: lista velha (outra janela) não fecha nada', async () => {
    store.update((s) => void s.projects.push(p2));
    const r = await call('PUT', '/api/open', { openProjectIds: ['p1'], activeProjectId: 'p1' });
    expect(r.statusCode).toBe(200);
    expect(closed).toEqual([]);
    expect(r.json()).toMatchObject({ openProjectIds: ['p1', 'p2'], activeProjectId: 'p1' });
    expect((await call('GET', '/api/open')).json()).toMatchObject({ openProjectIds: ['p1', 'p2'], activeProjectId: 'p1' });
    expect(openChanged()).toMatchObject([{ type: 'open-changed', openProjectIds: ['p1', 'p2'], activeProjectId: 'p1' }]);
    // Ordem: reordena os abertos, sem adicionar nem remover.
    const o = await call('PUT', '/api/open', { openProjectIds: ['p2', 'p1', 'zz'], activeProjectId: 'p2' });
    expect(o.json()).toMatchObject({ openProjectIds: ['p2', 'p1'], activeProjectId: 'p2' });
    // Ativo que não está aberto é ignorado.
    expect((await call('PUT', '/api/open', { activeProjectId: 'zz' })).json().activeProjectId).toBe('p2');
    expect((await call('PUT', '/api/open', { activeProjectId: null })).json().activeProjectId).toBeNull();
    expect((await call('PUT', '/api/open', { openProjectIds: 'x' })).statusCode).toBe(400);
  });

  it('estado de abas tem versão crescente; o evento leva a mesma versão da resposta', async () => {
    store.update((s) => void s.projects.push(p2));
    const v0 = (await call('GET', '/api/open')).json().version;
    expect(typeof v0).toBe('number');
    const a = (await call('POST', '/api/projects/p2/open')).json();
    const b = (await call('PUT', '/api/open', { activeProjectId: 'p1' })).json();
    expect(a.version).toBeGreaterThan(v0);
    expect(b.version).toBeGreaterThan(a.version);
    expect(openChanged().map((e) => (e as { version: number }).version)).toEqual([a.version, b.version]);
    expect((await call('GET', '/api/open')).json().version).toBe(b.version);
  });

  it('POST /api/projects/:id/open adiciona e ativa; /close fecha só aquele projeto', async () => {
    store.update((s) => {
      s.projects.push(p2);
      s.openProjectIds = ['p1'];
      s.activeProjectId = 'p1';
    });
    const o = await call('POST', '/api/projects/p2/open');
    expect(o.statusCode).toBe(200);
    expect(o.json()).toMatchObject({ openProjectIds: ['p1', 'p2'], activeProjectId: 'p2' });
    expect((await call('POST', '/api/projects/p2/open')).json().openProjectIds).toEqual(['p1', 'p2']);
    expect(closed).toEqual([]);
    const c = await call('POST', '/api/projects/p2/close');
    expect(c.statusCode).toBe(200);
    expect(closed).toEqual(['p2']);
    expect(c.json()).toMatchObject({ openProjectIds: ['p1'], activeProjectId: 'p1' });
    expect(openChanged().at(-1)).toMatchObject({ type: 'open-changed', openProjectIds: ['p1'], activeProjectId: 'p1' });
    // Fechar o ativo cai para o último aberto; fechar o último deixa sem ativo.
    expect((await call('POST', '/api/projects/p1/close')).json()).toMatchObject({ openProjectIds: [], activeProjectId: null });
    expect((await call('POST', '/api/projects/zz/open')).statusCode).toBe(404);
    expect((await call('POST', '/api/projects/zz/close')).statusCode).toBe(404);
  });

  it('POST /api/projects devolve project e warnings; register inexistente é 404', async () => {
    const r = await call('POST', '/api/projects', { env: 'windows', name: 'x', baseDir: 'C:\\GIT', github: { private: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().warnings).toEqual(['github-falhou: x']);
    const g = await call('POST', '/api/projects/register', { env: 'windows', path: 'Z:\\n' });
    expect(g.statusCode).toBe(404);
    expect(g.json().erro).toBeTruthy();
    projectsImpl.register = async () => {
      throw new ProjectError('já existe um projeto "x" neste ambiente', 'conflito');
    };
    expect((await call('POST', '/api/projects/register', { env: 'windows', path: 'C:\\x' })).statusCode).toBe(409);
  });

  it('ProjectError: status pelo code, não pela mensagem', async () => {
    projectsImpl.create = async () => {
      throw new ProjectError('Configure git user.name e user.email no Windows: ...', 'git-identidade');
    };
    const r = await call('POST', '/api/projects', { env: 'windows', name: 'x', baseDir: 'C:\\GIT', github: false });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ erro: 'git-identidade', mensagem: 'Configure git user.name e user.email no Windows: ...' });
    // Mensagem com "inválido" mas code conflito continua 409.
    projectsImpl.create = async () => {
      throw new ProjectError('nome inválido? não: conflito', 'conflito');
    };
    expect((await call('POST', '/api/projects', { env: 'windows', name: 'x', baseDir: 'C:\\GIT' })).statusCode).toBe(409);
    projectsImpl.create = async () => {
      throw new ProjectError('qualquer', 'invalido');
    };
    expect((await call('POST', '/api/projects', { env: 'windows', name: 'x', baseDir: 'C:\\GIT' })).statusCode).toBe(400);
  });

  it('POST gitignore de projeto desconhecido é 404 projeto-desconhecido', async () => {
    const r = await call('POST', '/api/projects/zz/gitignore');
    expect(r.statusCode).toBe(404);
    expect(r.json().erro).toBe('projeto-desconhecido');
    expect((await call('POST', '/api/projects/p1/gitignore')).statusCode).toBe(200);
  });

  it('DELETE projeto desconhecido é 404', async () => {
    expect((await call('DELETE', '/api/projects/zzz')).statusCode).toBe(404);
    expect((await call('DELETE', '/api/projects/p1')).statusCode).toBe(204);
    expect(removed).toEqual(['p1']);
    expect(closed).toEqual([]);
    expect(events.some((e) => e.type === 'open-changed')).toBe(true);
  });

  it('GET /api/environments devolve envs, roots e hints', async () => {
    const r = await call('GET', '/api/environments');
    const j = r.json();
    expect(j.envs.map((e: EnvTools) => e.env)).toEqual(['windows', 'wsl:Ubuntu']);
    expect(j.roots).toEqual(config.roots);
    expect(j.hints).toEqual(INSTALL_HINTS);
  });

  it('GET /api/gh/status devolve orgs; falha em orgs vira lista vazia', async () => {
    expect((await call('GET', '/api/gh/status?env=windows')).json()).toEqual({ installed: true, loggedIn: true, user: 'u', orgs: ['org1'] });
    ghOrgsFail = true;
    expect((await call('GET', '/api/gh/status')).json().orgs).toEqual([]);
  });

  it('POST vscode usa o projeto', async () => {
    expect((await call('POST', '/api/projects/p1/vscode')).statusCode).toBe(200);
    expect(launched).toEqual([proj]);
    expect((await call('POST', '/api/projects/nope/vscode')).statusCode).toBe(404);
  });

  it('rotas exigem autenticação', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/projects', headers: { host: `localhost:${config.port}` } });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('vscode', () => {
  it('WSL com espaço no caminho', () => {
    const p: Project = { id: 'a', name: 'n', env: 'wsl:Ubuntu', path: '/home/u/meu projeto', createdAt: '' };
    expect(buildVsCodeCommand(p)).toEqual({ file: 'code', args: ['--remote', 'wsl+Ubuntu', '/home/u/meu projeto'] });
  });

  it('Windows: code <path>', () => {
    expect(buildVsCodeCommand({ ...proj, path: 'C:\\GIT\\meu projeto' })).toEqual({ file: 'code', args: ['C:\\GIT\\meu projeto'] });
  });

  it('launch no Windows cita cada argumento (espaço fica em um argumento só) e usa shell', () => {
    const calls: { file: string; args: string[]; opts: unknown }[] = [];
    const spawnFn = (file: string, args: string[], opts: unknown) => {
      calls.push({ file, args, opts });
      return { unref() {} };
    };
    launchVsCode({ ...proj, path: 'C:\\GIT\\meu projeto' }, spawnFn, true);
    expect(calls[0].file).toBe('code');
    expect(calls[0].args).toEqual(['"C:\\GIT\\meu projeto"']);
    expect(calls[0].opts).toEqual({ shell: true, detached: true, stdio: 'ignore' });
  });

  it('rejeita aspas e % no caminho', () => {
    const spawnFn = () => ({ unref() {} });
    expect(() => launchVsCode({ ...proj, path: 'C:\\a"b' }, spawnFn, true)).toThrow();
    expect(() => launchVsCode({ ...proj, path: 'C:\\%PATH%' }, spawnFn, true)).toThrow();
  });
});
