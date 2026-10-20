import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Store } from '../store/store.js';
import { ProjectError, type ProjectService } from '../projects/projects.js';
import type { SessionService } from '../sessions/sessions.js';
import type { Project } from '../types.js';
import { launchVsCode } from '../vscode.js';
import { erro, findProject, isEnvId, unknownProject } from './util.js';

export interface ProjectRouteDeps {
  store: Store;
  projects: Pick<ProjectService, 'list' | 'create' | 'register' | 'createGitignore' | 'remove'>;
  sessions: Pick<SessionService, 'closeProject'>;
  launchVsCode?: (p: Project) => void;
}

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof ProjectError) {
    if (/inválido/.test(e.message)) return erro(reply, 400, 'invalido', e.message);
    if (/não encontrad/.test(e.message)) return erro(reply, 404, 'nao-encontrado', e.message);
    return erro(reply, 409, 'conflito', e.message);
  }
  throw e;
}

function parseGithub(v: unknown): false | { owner?: string; private: boolean } {
  if (!v || typeof v !== 'object') return false;
  const o = v as { owner?: unknown; private?: unknown };
  return {
    ...(typeof o.owner === 'string' && o.owner ? { owner: o.owner } : {}),
    private: o.private !== false,
  };
}

export function registerProjectRoutes(app: FastifyInstance, d: ProjectRouteDeps): void {
  app.get('/api/projects', async () => d.projects.list());

  app.post<{ Body: { env?: unknown; name?: unknown; baseDir?: unknown; github?: unknown } }>('/api/projects', async (req, reply) => {
    const b = req.body ?? {};
    if (!isEnvId(b.env) || typeof b.name !== 'string' || typeof b.baseDir !== 'string') {
      return erro(reply, 400, 'invalido', 'informe env, name e baseDir');
    }
    try {
      return await d.projects.create({ env: b.env, name: b.name, baseDir: b.baseDir, github: parseGithub(b.github) });
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Body: { env?: unknown; path?: unknown; github?: unknown } }>('/api/projects/register', async (req, reply) => {
    const b = req.body ?? {};
    if (!isEnvId(b.env) || typeof b.path !== 'string' || !b.path.trim()) {
      return erro(reply, 400, 'invalido', 'informe env e path');
    }
    try {
      return await d.projects.register({ env: b.env, path: b.path, github: parseGithub(b.github) });
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/gitignore', async (req, reply) => {
    try {
      await d.projects.createGitignore(req.params.id);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!findProject(d.store, req.params.id)) return unknownProject(reply);
    d.sessions.closeProject(req.params.id);
    d.projects.remove(req.params.id);
    return reply.code(204).send();
  });

  app.get('/api/open', async () => {
    const s = d.store.get();
    return { openProjectIds: s.openProjectIds, activeProjectId: s.activeProjectId ?? null };
  });

  app.put<{ Body: { openProjectIds?: unknown; activeProjectId?: unknown } }>('/api/open', async (req, reply) => {
    const b = req.body ?? {};
    if (!Array.isArray(b.openProjectIds) || !b.openProjectIds.every((x) => typeof x === 'string')) {
      return erro(reply, 400, 'invalido', 'openProjectIds deve ser uma lista de ids');
    }
    const open = b.openProjectIds as string[];
    const active = typeof b.activeProjectId === 'string' ? b.activeProjectId : undefined;
    const removed = d.store.get().openProjectIds.filter((x) => !open.includes(x));
    for (const id of removed) d.sessions.closeProject(id);
    d.store.update((s) => {
      s.openProjectIds = open;
      if (active) s.activeProjectId = active;
      else delete s.activeProjectId;
    });
    return { openProjectIds: open, activeProjectId: active ?? null };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/vscode', async (req, reply) => {
    const p = findProject(d.store, req.params.id);
    if (!p) return unknownProject(reply);
    try {
      (d.launchVsCode ?? launchVsCode)(p);
    } catch (e) {
      return erro(reply, 400, 'vscode', e instanceof Error ? e.message : String(e));
    }
    return { ok: true };
  });
}
