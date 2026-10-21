import type { FastifyReply } from 'fastify';
import type { EnvId, Project } from '../types.js';
import type { Store } from '../store/store.js';

export function erro(reply: FastifyReply, status: number, codigo: string, mensagem: string) {
  return reply.code(status).send({ erro: codigo, mensagem });
}

export function findProject(store: Store, id: string): Project | undefined {
  return store.get().projects.find((p) => p.id === id);
}

export function unknownProject(reply: FastifyReply) {
  return erro(reply, 404, 'projeto-desconhecido', 'projeto não encontrado');
}

export function isEnvId(v: unknown): v is EnvId {
  return typeof v === 'string' && /^(windows|wsl:.+)$/.test(v);
}
