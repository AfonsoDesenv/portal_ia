import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
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
  return app;
}
