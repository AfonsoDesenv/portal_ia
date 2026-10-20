import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SessionKind } from '../types.js';
import { SessionError, ToolMissingError, type SessionService } from '../sessions/sessions.js';

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof ToolMissingError) {
    return reply.code(422).send({ erro: 'ferramenta-ausente', ferramenta: e.tool, dica: e.hint });
  }
  if (e instanceof SessionError) {
    const status = e.code === 'projeto-desconhecido' || e.code === 'sessao-desconhecida' ? 404 : 409;
    return reply.code(status).send({ erro: e.code, mensagem: e.message });
  }
  throw e;
}

export function registerSessionRoutes(app: FastifyInstance, sessions: SessionService): void {
  app.get<{ Params: { id: string } }>('/api/projects/:id/sessions', async (req) => sessions.list(req.params.id));

  app.post<{ Params: { id: string }; Body: { kind?: SessionKind; resumeClaudeId?: string } }>(
    '/api/projects/:id/sessions',
    async (req, reply) => {
      const kind = req.body?.kind;
      if (kind !== 'claude' && kind !== 'shell') return reply.code(400).send({ erro: 'kind inválido' });
      try {
        return await sessions.create(req.params.id, kind, { resumeClaudeId: req.body?.resumeClaudeId });
      } catch (e) {
        return fail(reply, e);
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/sessions/:id/resume', async (req, reply) => {
    try {
      return await sessions.resume(req.params.id);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    sessions.close(req.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/ws/term/:id', { websocket: true }, (socket, req) => {
    const id = req.params.id;
    const send = (o: unknown) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(o));
    };
    const att = sessions.attachTerm(
      id,
      (data) => send({ type: 'data', data }),
      (code) => send({ type: 'exit', code }),
    );
    if (!att) {
      socket.close(4404, 'sessão desconhecida');
      return;
    }
    send({ type: 'scrollback', data: att.scrollback });
    if (!att.alive) send({ type: 'exit', code: null });
    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; data?: unknown; cols?: unknown; rows?: unknown };
        if (msg.type === 'input' && typeof msg.data === 'string') sessions.write(id, msg.data);
        else if (msg.type === 'resize' && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
          sessions.resize(id, msg.cols, msg.rows);
        }
      } catch {
        /* mensagem inválida é ignorada */
      }
    });
    socket.on('close', () => att.detach());
  });
}
