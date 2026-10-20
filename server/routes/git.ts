import { posix, win32 } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { GitError, type Git } from '../git/git.js';
import type { Store } from '../store/store.js';
import type { Project, ServerEvent } from '../types.js';
import { erro, findProject, unknownProject } from './util.js';

export type GitLike = Pick<Git, 'status' | 'branches' | 'currentBranch' | 'createBranch' | 'checkout' | 'fileVersions' | 'commit' | 'push'>;

export interface GitRouteDeps {
  store: Store;
  gitFor: (p: Project) => GitLike;
  emit: (e: ServerEvent) => void;
}

/** Caminho relativo seguro dentro do projeto (sem absoluto, sem `..`, sem truques de barra invertida). */
export function isSafeRelPath(p: string): boolean {
  if (!p || p.includes('\0')) return false;
  if (posix.isAbsolute(p) || win32.isAbsolute(p) || /^[A-Za-z]:/.test(p) || /^[\\/]/.test(p)) return false;
  return !p.split(/[\\/]+/).some((seg) => seg === '..');
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TRAILER = 'Co-Authored-By: Claude <noreply@anthropic.com>';

export function registerGitRoutes(app: FastifyInstance, d: GitRouteDeps): void {
  const base = '/api/projects/:id/git';

  async function guarded<T>(reply: Parameters<typeof erro>[0], fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof GitError) {
        erro(reply, 409, 'git', e.message);
        return undefined;
      }
      throw e;
    }
  }

  app.get<{ Params: { id: string } }>(`${base}/status`, async (req, reply) => {
    const p = findProject(d.store, req.params.id);
    if (!p) return unknownProject(reply);
    const g = d.gitFor(p);
    const r = await guarded(reply, async () => ({ branch: await g.currentBranch(), files: await g.status() }));
    return r ?? reply;
  });

  app.get<{ Params: { id: string } }>(`${base}/branches`, async (req, reply) => {
    const p = findProject(d.store, req.params.id);
    if (!p) return unknownProject(reply);
    const g = d.gitFor(p);
    const r = await guarded(reply, async () => ({ current: await g.currentBranch(), ...(await g.branches()) }));
    return r ?? reply;
  });

  app.post<{ Params: { id: string }; Body: { name?: unknown; from?: unknown } }>(`${base}/branches`, async (req, reply) => {
    const p = findProject(d.store, req.params.id);
    if (!p) return unknownProject(reply);
    const { name, from } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.startsWith('-') || typeof from !== 'string' || !from.trim() || from.startsWith('-')) {
      return erro(reply, 400, 'invalido', 'informe name e from válidos');
    }
    const ok = await guarded(reply, async () => {
      await d.gitFor(p).createBranch(name.trim(), from.trim());
      return true;
    });
    if (!ok) return reply;
    d.emit({ type: 'git-changed', projectId: p.id });
    return { branch: name.trim() };
  });

  app.post<{ Params: { id: string }; Body: { branch?: unknown } }>(`${base}/checkout`, async (req, reply) => {
    const p = findProject(d.store, req.params.id);
    if (!p) return unknownProject(reply);
    const branch = req.body?.branch;
    if (typeof branch !== 'string' || !branch.trim() || branch.startsWith('-')) {
      return erro(reply, 400, 'invalido', 'informe uma branch válida');
    }
    const ok = await guarded(reply, async () => {
      await d.gitFor(p).checkout(branch.trim());
      return true;
    });
    if (!ok) return reply;
    d.emit({ type: 'git-changed', projectId: p.id });
    return { branch: branch.trim() };
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(`${base}/file`, async (req, reply) => {
    const p = findProject(d.store, req.params.id);
    if (!p) return unknownProject(reply);
    const path = req.query.path;
    if (typeof path !== 'string' || !isSafeRelPath(path)) {
      return erro(reply, 400, 'caminho-invalido', 'caminho fora do projeto');
    }
    const r = await guarded(reply, () => d.gitFor(p).fileVersions(path));
    return r ?? reply;
  });

  app.post<{ Params: { id: string }; Body: { files?: unknown; message?: unknown; push?: unknown } }>(`${base}/commit`, async (req, reply) => {
    const p = findProject(d.store, req.params.id);
    if (!p) return unknownProject(reply);
    const { files, message, push } = req.body ?? {};
    if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === 'string' && isSafeRelPath(f))) {
      return erro(reply, 400, 'invalido', 'selecione ao menos um arquivo (caminhos relativos ao projeto)');
    }
    if (typeof message !== 'string' || !message.trim()) {
      return erro(reply, 400, 'invalido', 'a mensagem do commit não pode ficar em branco');
    }
    const g = d.gitFor(p);
    const hash = await guarded(reply, () => g.commit(files as string[], `${message.trim()}\n\n${TRAILER}\n`));
    if (hash === undefined) return reply;
    let result: { hash: string; pushed: boolean; erroPush?: string } = { hash, pushed: false };
    if (push) {
      try {
        await g.push();
        result = { hash, pushed: true };
      } catch (e) {
        result = { hash, pushed: false, erroPush: msg(e) };
      }
    }
    d.emit({ type: 'git-changed', projectId: p.id });
    return result;
  });
}
