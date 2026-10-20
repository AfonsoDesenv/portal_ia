import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuth } from './auth.js';
import type { Config } from './config.js';

export interface AppDeps {
  config: Config;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify();
  registerAuth(app, deps.config);
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}
