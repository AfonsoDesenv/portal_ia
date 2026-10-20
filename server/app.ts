import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { registerAuth } from './auth.js';
import type { Config } from './config.js';
import type { SessionService } from './sessions/sessions.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerEventRoutes } from './routes/events.js';

export interface AppDeps {
  config: Config;
  sessions?: SessionService;
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
    });
  }
  return app;
}
