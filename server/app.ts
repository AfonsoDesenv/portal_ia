import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { registerAuth } from './auth.js';
import type { Config } from './config.js';
import type { SessionService } from './sessions/sessions.js';
import type { ProjectService } from './projects/projects.js';
import type { Store } from './store/store.js';
import type { GitHub } from './github/gh.js';
import type { EnvId, EnvTools, Project } from './types.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerEventRoutes } from './routes/events.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerGitRoutes, type GitLike } from './routes/git.js';
import { registerEnvRoutes } from './routes/env.js';

export interface AppDeps {
  config: Config;
  sessions?: SessionService;
  /** Rotas de projetos/git/ambiente só são registradas quando todos abaixo vêm junto. */
  store?: Store;
  projects?: ProjectService;
  github?: GitHub;
  gitFor?: (p: Project) => GitLike;
  listEnvs?: () => Promise<EnvId[]>;
  detectTools?: (env: EnvId) => Promise<EnvTools>;
  launchVsCode?: (p: Project) => void;
  /** Pasta do front compilado (dist/web). Sem ela, só a API é servida. */
  webDir?: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();
  registerAuth(app, deps.config);
  app.register(websocket);
  app.get('/api/health', async () => ({ ok: true }));
  if (deps.sessions) {
    const sessions = deps.sessions;
    app.register(async (scope) => {
      registerSessionRoutes(scope, sessions);
      registerEventRoutes(scope, sessions);
      const { store, projects, github, gitFor, listEnvs, detectTools } = deps;
      if (store && projects && github && gitFor && listEnvs && detectTools) {
        registerProjectRoutes(scope, { store, projects, sessions, launchVsCode: deps.launchVsCode });
        registerGitRoutes(scope, { store, gitFor, emit: (e) => sessions.emitEvent(e) });
        registerEnvRoutes(scope, { config: deps.config, github, listEnvs, detectTools });
      }
    });
  }
  if (deps.webDir) {
    // Atrás da auth (hook global). Serve os arquivos e cai no index.html para rotas do SPA.
    app.register(fastifyStatic, { root: deps.webDir });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0];
      if (req.method === 'GET' && !path.startsWith('/api') && !path.startsWith('/ws')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Não encontrado' });
    });
  }
  return app;
}
