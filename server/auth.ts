import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { Config } from './config.js';

export const COOKIE_NAME = 'portal_key';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Valida Host, Origin (upgrade WS) e cookie `portal_key` em todo request. */
export function registerAuth(app: FastifyInstance, config: Config): void {
  app.register(cookie);
  const hosts = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  app.addHook('onRequest', async (req, reply) => {
    if (!req.headers.host || !hosts.has(req.headers.host.toLowerCase())) {
      return reply.code(403).send({ error: 'Host não permitido' });
    }
    if (String(req.headers.upgrade ?? '').toLowerCase() === 'websocket') {
      const origin = req.headers.origin;
      if (!origin || !origins.has(origin.toLowerCase())) {
        return reply.code(403).send({ error: 'Origin não permitido' });
      }
    }
    // CSRF: requests que alteram estado só vindos do próprio portal.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin !== undefined && !origins.has(origin.toLowerCase())) {
        return reply.code(403).send({ error: 'Origin não permitido' });
      }
      const site = req.headers['sec-fetch-site'];
      if (site !== undefined && site !== 'same-origin') {
        return reply.code(403).send({ error: 'Requisição de outro site não permitida' });
      }
    }

    const key = (req.query as { key?: unknown } | undefined)?.key;
    if (typeof key === 'string' && req.url.split('?')[0] === '/') {
      if (!safeEqual(key, config.token)) return reply.code(401).send({ error: 'Chave inválida' });
      reply.setCookie(COOKIE_NAME, config.token, { httpOnly: true, sameSite: 'strict', path: '/' });
      return reply.redirect('/', 302);
    }

    const sent = req.cookies[COOKIE_NAME];
    if (!sent || !safeEqual(sent, config.token)) {
      return reply.code(401).send({ error: 'Não autorizado' });
    }
  });
}
