import type { FastifyInstance } from 'fastify';
import type { ServerEvent } from '../types.js';
import type { SessionService } from '../sessions/sessions.js';

export function registerEventRoutes(app: FastifyInstance, sessions: SessionService): void {
  app.get('/ws/events', { websocket: true }, (socket) => {
    const onEvent = (ev: ServerEvent) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(ev));
    };
    sessions.on('event', onEvent);
    socket.on('close', () => sessions.off('event', onEvent));
  });
}
