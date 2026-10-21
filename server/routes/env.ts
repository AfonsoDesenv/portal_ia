import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { EnvId, EnvTools } from '../types.js';
import type { GitHub } from '../github/gh.js';
import { INSTALL_HINTS } from '../env/environments.js';
import { erro, isEnvId } from './util.js';

export interface EnvRouteDeps {
  config: Config;
  github: Pick<GitHub, 'status' | 'orgs'>;
  listEnvs: () => Promise<EnvId[]>;
  detectTools: (env: EnvId) => Promise<EnvTools>;
}

export function registerEnvRoutes(app: FastifyInstance, d: EnvRouteDeps): void {
  app.get('/api/environments', async () => {
    const ids = await d.listEnvs();
    const envs = await Promise.all(ids.map((e) => d.detectTools(e)));
    return { envs, roots: d.config.roots, hints: INSTALL_HINTS };
  });

  app.get<{ Querystring: { env?: string } }>('/api/gh/status', async (req, reply) => {
    const env = req.query.env ?? 'windows';
    if (!isEnvId(env)) return erro(reply, 400, 'env-invalido', 'ambiente inválido');
    const st = await d.github.status(env);
    let orgs: string[] = [];
    if (st.loggedIn) {
      try {
        orgs = await d.github.orgs(env);
      } catch {
        orgs = [];
      }
    }
    return { installed: st.installed, loggedIn: st.loggedIn, user: st.user ?? null, orgs };
  });
}
