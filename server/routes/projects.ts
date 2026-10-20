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
  sessions: Pick<SessionService, 'closeProject' | 'removeProject' | 'emitEvent'>;
  launchVsCode?: (p: Project) => void;
}

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof ProjectError) {
    const status = e.code === 'invalido' ? 400 : e.code === 'nao-encontrado' || e.code === 'projeto-desconhecido' ? 404 : 409;
    return erro(reply, status, e.code, e.message);
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
  const openState = () => {
    const s = d.store.get();
    return { openProjectIds: [...s.openProjectIds], activeProjectId: s.activeProjectId ?? null };
  };
  /** Devolve o estado de abas e avisa as outras janelas. */
  const openChanged = () => {
    const st = openState();
    d.sessions.emitEvent({ type: 'open-changed', ...st });
    return st;
  };

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
    if (!findProject(d.store, req.params.id)) return unknownProject(reply);
    try {
      await d.projects.createGitignore(req.params.id);
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (!findProject(d.store, req.params.id)) return unknownProject(reply);
    d.sessions.removeProject(req.params.id);
    d.projects.remove(req.params.id);
    openChanged();
    return reply.code(204).send();
  });

  app.get('/api/open', async () => openState());

  /**
   * Só troca o projeto ativo (e, opcionalmente, a ordem das abas). Nunca abre nem fecha projetos:
   * uma janela com lista desatualizada não pode encerrar sessões de outra.
   */
  app.put<{ Body: { openProjectIds?: unknown; activeProjectId?: unknown } }>('/api/open', async (req, reply) => {
    const b = req.body ?? {};
    if (b.openProjectIds !== undefined && (!Array.isArray(b.openProjectIds) || !b.openProjectIds.every((x) => typeof x === 'string'))) {
      return erro(reply, 400, 'invalido', 'openProjectIds deve ser uma lista de ids');
    }
    const order = (b.openProjectIds as string[] | undefined) ?? [];
    d.store.update((s) => {
      const cur = s.openProjectIds;
      s.openProjectIds = [...order.filter((x, i) => cur.includes(x) && order.indexOf(x) === i), ...cur.filter((x) => !order.includes(x))];
      if (b.activeProjectId === null) delete s.activeProjectId;
      else if (typeof b.activeProjectId === 'string' && cur.includes(b.activeProjectId)) s.activeProjectId = b.activeProjectId;
    });
    return openChanged();
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/open', async (req, reply) => {
    const id = req.params.id;
    if (!findProject(d.store, id)) return unknownProject(reply);
    d.store.update((s) => {
      if (!s.openProjectIds.includes(id)) s.openProjectIds.push(id);
      s.activeProjectId = id;
    });
    return openChanged();
  });

  /** Fecha a aba do projeto: encerra os processos; as sessões ficam paradas para "Retomar". */
  app.post<{ Params: { id: string } }>('/api/projects/:id/close', async (req, reply) => {
    const id = req.params.id;
    if (!findProject(d.store, id)) return unknownProject(reply);
    d.sessions.closeProject(id);
    d.store.update((s) => {
      s.openProjectIds = s.openProjectIds.filter((x) => x !== id);
      if (s.activeProjectId === id || (s.activeProjectId && !s.openProjectIds.includes(s.activeProjectId))) {
        const last = s.openProjectIds[s.openProjectIds.length - 1];
        if (last) s.activeProjectId = last;
        else delete s.activeProjectId;
      }
    });
    return openChanged();
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
