import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type Config } from '../server/config.js';
import { buildApp } from '../server/app.js';
import { Store } from '../server/store/store.js';
import { INSTALL_HINTS } from '../server/env/environments.js';
import { SessionService, ToolMissingError, type PtyLike } from '../server/sessions/sessions.js';
import type { Launch, LaunchParams } from '../server/pty/launch.js';
import type { EnvId, EnvTools, ProjectView, ServerEvent } from '../server/types.js';

class FakePty extends EventEmitter implements PtyLike {
  spawns: { id: string; launch: Launch; cwd?: string }[] = [];
  alive = new Set<string>();
  known = new Set<string>();
  writes: string[] = [];
  listeners = new Map<string, Set<(d: string) => void>>();
  spawn(id: string, launch: Launch, cwd?: string) {
    if (this.alive.has(id)) throw new Error('vivo');
    this.spawns.push({ id, launch, cwd });
    this.alive.add(id);
    this.known.add(id);
  }
  write(id: string, d: string) {
    this.writes.push(d);
  }
  resize() {}
  kill(id: string) {
    this.finish(id, 0);
  }
  attach(id: string, onData: (d: string) => void) {
    if (!this.known.has(id)) throw new Error('desconhecido');
    const set = this.listeners.get(id) ?? new Set();
    this.listeners.set(id, set);
    set.add(onData);
    return { scrollback: 'antes', detach: () => void set.delete(onData) };
  }
  isAlive(id: string) {
    return this.alive.has(id);
  }
  forget(id: string) {
    this.known.delete(id);
  }
  emitData(id: string, d: string) {
    for (const l of this.listeners.get(id) ?? []) l(d);
  }
  finish(id: string, code: number) {
    if (!this.alive.delete(id)) return;
    this.emit('exit', id, code);
  }
}

class FakeWatcher extends EventEmitter {
  watched: string[] = [];
  watch(id: string) {
    this.watched.push(id);
  }
  unwatch() {}
}

let dir: string;
let config: Config;
let storeFile: string;
let pty: FakePty;
let watcher: FakeWatcher;
let launches: LaunchParams[];
let toolsCalls: number;
let claudeOk: boolean;
let project: ProjectView;
let svc: SessionService;
let clock: number;
let toolsGate: Promise<void> | null;
let listGate: Promise<void> | null;

function make(store = Store.open(storeFile)) {
  return new SessionService({
    store,
    projects: {
      list: async () => {
        await listGate;
        return [project];
      },
    },
    config,
    pty,
    watcher,
    detectTools: async (env: EnvId): Promise<EnvTools> => {
      toolsCalls++;
      await toolsGate;
      return { env, git: true, claude: claudeOk, gh: false, ghLoggedIn: false };
    },
    buildLaunch: (p) => {
      launches.push(p);
      return { file: 'cmd.exe', args: ['/k'] };
    },
    now: () => clock,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portal-ia-sess-'));
  config = loadConfig(dir);
  storeFile = join(dir, 'state.json');
  pty = new FakePty();
  watcher = new FakeWatcher();
  launches = [];
  toolsCalls = 0;
  claudeOk = true;
  clock = 1000;
  toolsGate = null;
  listGate = null;
  project = { id: 'p1', name: 'x', env: 'windows', path: dir, createdAt: '', missing: false };
  svc = make();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('SessionService', () => {
  it('cria 2 sessões claude com títulos Claude 1 e Claude 2 e shell com Terminal 1', async () => {
    const a = await svc.create('p1', 'claude');
    const b = await svc.create('p1', 'claude');
    const t = await svc.create('p1', 'shell');
    expect([a.title, b.title, t.title]).toEqual(['Claude 1', 'Claude 2', 'Terminal 1']);
    expect(a.alive).toBe(true);
    expect(a.status).toBe('parado');
    expect(svc.list('p1')).toHaveLength(3);
  });

  it('título não repete depois de fechar uma sessão do meio', async () => {
    const a = await svc.create('p1', 'claude');
    await svc.create('p1', 'claude');
    svc.close(a.id);
    const c = await svc.create('p1', 'claude');
    expect(c.title).toBe('Claude 3');
  });

  it('recriar o serviço com o mesmo store mostra as sessões como não vivas', async () => {
    await svc.create('p1', 'claude');
    await svc.create('p1', 'claude');
    const again = make();
    const list = again.list('p1');
    expect(list).toHaveLength(2);
    expect(list.every((s) => !s.alive && s.status === 'parado')).toBe(true);
  });

  it('create com resumeClaudeId passa --resume e --settings', async () => {
    await svc.create('p1', 'claude', { resumeClaudeId: 'abc' });
    const args = launches[0].claudeArgs!;
    expect(args[0]).toBe('--settings');
    expect(args.slice(-2)).toEqual(['--resume', 'abc']);
  });

  it('sem claude no ambiente lança ToolMissingError com a dica do WSL e a rota devolve 422', async () => {
    claudeOk = false;
    project = { ...project, env: 'wsl:Ubuntu' };
    await expect(svc.create('p1', 'claude')).rejects.toBeInstanceOf(ToolMissingError);
    const app = buildApp({ config, sessions: svc });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/p1/sessions',
      payload: { kind: 'claude' },
      headers: { host: `localhost:${config.port}`, cookie: `portal_key=${config.token}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ erro: 'ferramenta-ausente', ferramenta: 'claude', dica: INSTALL_HINTS.claude.wsl });
    expect(await svc.list('p1')).toHaveLength(0);
    await app.close();
  });

  it('terminal shell não exige claude', async () => {
    claudeOk = false;
    const s = await svc.create('p1', 'shell');
    expect(s.alive).toBe(true);
  });

  it('projeto com pasta ausente dá erro claro', async () => {
    project = { ...project, missing: true };
    await expect(svc.create('p1', 'shell')).rejects.toThrow(/não encontrada/);
  });

  it('detectTools é cacheado por 60 s por ambiente', async () => {
    await svc.create('p1', 'claude');
    await svc.create('p1', 'claude');
    expect(toolsCalls).toBe(1);
    clock += 61_000;
    await svc.create('p1', 'claude');
    expect(toolsCalls).toBe(2);
  });

  it('status do watcher atualiza a sessão e emite evento; claude-id é persistido', async () => {
    const events: ServerEvent[] = [];
    svc.on('event', (e) => events.push(e));
    const s = await svc.create('p1', 'claude');
    events.length = 0;
    watcher.emit('status', s.id, 'trabalhando');
    expect(events).toEqual([{ type: 'session', session: expect.objectContaining({ id: s.id, status: 'trabalhando' }) }]);
    watcher.emit('claude-id', s.id, 'cid-1');
    expect(svc.list('p1')[0].claudeSessionId).toBe('cid-1');
    expect(make().list('p1')[0].claudeSessionId).toBe('cid-1');
  });

  it('saída do processo: parado, não viva, evento emitido', async () => {
    const s = await svc.create('p1', 'claude');
    watcher.emit('status', s.id, 'esperando');
    const events: ServerEvent[] = [];
    svc.on('event', (e) => events.push(e));
    pty.finish(s.id, 1);
    expect(svc.list('p1')[0]).toMatchObject({ alive: false, status: 'parado' });
    expect(events[0]).toMatchObject({ type: 'session', session: { id: s.id, alive: false, status: 'parado' } });
  });

  it('resume reinicia no mesmo id com --resume e trunca o arquivo de status', async () => {
    const s = await svc.create('p1', 'claude');
    watcher.emit('claude-id', s.id, 'cid-9');
    pty.finish(s.id, 0);
    const statusFile = join(config.tempDir, 'status', `${s.id}.jsonl`);
    writeFileSync(statusFile, '{"hook_event_name":"Stop"}\n');
    const r = await svc.resume(s.id);
    expect(r).toMatchObject({ id: s.id, title: 'Claude 1', alive: true });
    expect(launches[1].claudeArgs!.slice(-2)).toEqual(['--resume', 'cid-9']);
    expect(pty.spawns.map((x) => x.id)).toEqual([s.id, s.id]);
    expect(statSync(statusFile).size).toBe(0);
    expect(svc.list('p1')).toHaveLength(1);
  });

  it('resume sem claude-id ou com sessão viva falha', async () => {
    const s = await svc.create('p1', 'claude');
    await expect(svc.resume(s.id)).rejects.toThrow(/já está em execução/);
    pty.finish(s.id, 0);
    await expect(svc.resume(s.id)).rejects.toThrow(/id do Claude/);
  });

  it('close mata, remove do store e emite session-removed', async () => {
    const s = await svc.create('p1', 'claude');
    const events: ServerEvent[] = [];
    svc.on('event', (e) => events.push(e));
    svc.close(s.id);
    expect(events).toEqual([{ type: 'session-removed', id: s.id }]);
    expect(make().list('p1')).toHaveLength(0);
    expect(pty.isAlive(s.id)).toBe(false);
  });

  it('close durante o start não deixa processo órfão (create)', async () => {
    let release!: () => void;
    toolsGate = new Promise<void>((r) => (release = r));
    const p = svc.create('p1', 'claude');
    const rejected = expect(p).rejects.toThrow(/fechada/);
    await new Promise((r) => setTimeout(r, 10));
    const [rec] = svc.list('p1');
    svc.close(rec.id);
    release();
    await rejected;
    expect(pty.spawns).toHaveLength(0);
    expect(watcher.watched).toHaveLength(0);
    expect(svc.list('p1')).toHaveLength(0);
  });

  it('close durante o resume não deixa processo órfão', async () => {
    const s = await svc.create('p1', 'claude');
    watcher.emit('claude-id', s.id, 'c1');
    pty.finish(s.id, 0);
    let release!: () => void;
    listGate = new Promise<void>((r) => (release = r));
    const p = svc.resume(s.id);
    const rejected = expect(p).rejects.toThrow(/fechada/);
    svc.close(s.id);
    release();
    await rejected;
    expect(pty.spawns).toHaveLength(1);
  });

  it('resumes concorrentes: o perdedor recebe ja-em-execucao e o estado fica íntegro', async () => {
    const s = await svc.create('p1', 'claude');
    watcher.emit('claude-id', s.id, 'c1');
    pty.finish(s.id, 0);
    let release!: () => void;
    listGate = new Promise<void>((r) => (release = r));
    const a = svc.resume(s.id);
    const b = svc.resume(s.id);
    await expect(b).rejects.toMatchObject({ code: 'ja-em-execucao' });
    release();
    await expect(a).resolves.toMatchObject({ id: s.id, alive: true });
    expect(pty.spawns).toHaveLength(2);
    expect(svc.list('p1')[0].alive).toBe(true);
  });

  it('closeProject encerra os processos mas mantém as sessões (paradas) para Retomar', async () => {
    const events: ServerEvent[] = [];
    svc.on('event', (e: ServerEvent) => events.push(e));
    const a = await svc.create('p1', 'claude');
    watcher.emit('claude-id', a.id, 'c1');
    const b = await svc.create('p1', 'shell');
    svc.closeProject('p1');
    expect(pty.alive.size).toBe(0);
    const l = svc.list('p1');
    expect(l.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(l.every((s) => !s.alive && s.status === 'parado')).toBe(true);
    expect(events.some((e) => e.type === 'session-removed')).toBe(false);
    expect(events.filter((e) => e.type === 'session' && !e.session.alive)).toHaveLength(2);
    // Persistido: um serviço novo (reinício) também lista as sessões.
    expect(make().list('p1')).toHaveLength(2);
    // Reabrir: retomar funciona no mesmo id.
    await expect(svc.resume(a.id)).resolves.toMatchObject({ id: a.id, alive: true });
    expect(pty.spawns.at(-1)?.id).toBe(a.id);
  });

  it('closeProject durante um create em andamento não deixa processo vivo', async () => {
    let release!: () => void;
    toolsGate = new Promise<void>((r) => (release = r));
    const p = svc.create('p1', 'claude');
    await new Promise((r) => setTimeout(r, 0));
    svc.closeProject('p1');
    release();
    await expect(p).rejects.toBeTruthy();
    expect(pty.alive.size).toBe(0);
  });

  it('removeProject apaga as sessões do projeto', async () => {
    await svc.create('p1', 'claude');
    await svc.create('p1', 'shell');
    svc.removeProject('p1');
    expect(svc.list('p1')).toHaveLength(0);
    expect(pty.alive.size).toBe(0);
  });
});

describe('WebSockets', () => {
  let app: FastifyInstance;
  let port: number;
  const headers = () => ({
    host: `localhost:${config.port}`,
    origin: `http://localhost:${config.port}`,
    cookie: `portal_key=${config.token}`,
  });

  beforeEach(async () => {
    app = buildApp({ config, sessions: svc });
    await app.listen({ host: '127.0.0.1', port: 0 });
    port = (app.server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    app.server.closeAllConnections();
    await app.close();
  });

  const open = (path: string, h: Record<string, string> = headers()) => new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: h });
  const messages = (ws: WebSocket) => {
    const out: any[] = [];
    ws.on('message', (m) => out.push(JSON.parse(String(m))));
    return out;
  };
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(fn()).toBe(true);
  };

  it('/ws/term envia scrollback, dados vivos, aceita input e envia exit', async () => {
    const s = await svc.create('p1', 'shell');
    const ws = open(`/ws/term/${s.id}`);
    const msgs = messages(ws);
    await until(() => msgs.length >= 1);
    expect(msgs[0]).toEqual({ type: 'scrollback', data: 'antes' });
    pty.emitData(s.id, 'oi');
    await until(() => msgs.length >= 2);
    expect(msgs[1]).toEqual({ type: 'data', data: 'oi' });
    ws.send(JSON.stringify({ type: 'input', data: 'ls\r' }));
    await until(() => pty.writes.length === 1);
    expect(pty.writes[0]).toBe('ls\r');
    pty.finish(s.id, 3);
    await until(() => msgs.some((m) => m.type === 'exit'));
    expect(msgs.at(-1)).toEqual({ type: 'exit', code: 3 });
    ws.close();
  });

  it('/ws/term com id desconhecido fecha com 4404', async () => {
    const ws = open('/ws/term/nao-existe');
    const code = await new Promise<number>((res) => ws.on('close', (c) => res(c)));
    expect(code).toBe(4404);
  });

  it('/ws/term sem cookie ou com Origin errado é recusado', async () => {
    const s = await svc.create('p1', 'shell');
    for (const h of [{ ...headers(), cookie: 'portal_key=errado' }, { ...headers(), origin: 'http://evil.com' }]) {
      const res = await app.inject({
        url: `/ws/term/${s.id}`,
        headers: { ...h, connection: 'upgrade', upgrade: 'websocket' },
      });
      expect([401, 403]).toContain(res.statusCode);
    }
  });

  it('/ws/events recebe {type:session} quando o status muda', async () => {
    const s = await svc.create('p1', 'claude');
    const ws = open('/ws/events');
    const msgs = messages(ws);
    await new Promise((r) => ws.on('open', r));
    watcher.emit('status', s.id, 'trabalhando');
    await until(() => msgs.length >= 1);
    expect(msgs[0]).toMatchObject({ type: 'session', session: { id: s.id, status: 'trabalhando' } });
    ws.close();
  });
});

