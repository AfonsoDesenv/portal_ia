import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import type { Config } from '../config.js';
import { INSTALL_HINTS } from '../env/environments.js';
import type { Launch, LaunchParams } from '../pty/launch.js';
import type { ProjectService } from '../projects/projects.js';
import type { Store } from '../store/store.js';
import type { EnvId, EnvTools, ProjectView, ServerEvent, SessionInfo, SessionKind, SessionStatus } from '../types.js';
import { writeHookSettings } from './hooks.js';

/** Subconjunto do PtyManager usado aqui (permite fake nos testes). */
export interface PtyLike extends EventEmitter {
  spawn(id: string, launch: Launch, cwd?: string): void;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;
  attach(id: string, onData: (data: string) => void): { scrollback: string; detach(): void };
  isAlive(id: string): boolean;
  forget(id: string): void;
}

export interface WatcherLike extends EventEmitter {
  watch(sessionId: string, statusFile: string): void;
  unwatch(sessionId: string): void;
}

export interface SessionDeps {
  store: Store;
  projects: Pick<ProjectService, 'list'>;
  config: Config;
  pty: PtyLike;
  watcher: WatcherLike;
  detectTools: (env: EnvId) => Promise<EnvTools>;
  buildLaunch: (p: LaunchParams) => Launch;
  /** Relógio injetável (cache de detectTools). */
  now?: () => number;
}

export class ToolMissingError extends Error {
  constructor(
    readonly tool: 'claude',
    readonly env: EnvId,
    readonly hint: string,
  ) {
    super(`${tool} não encontrado no ambiente ${env}`);
    this.name = 'ToolMissingError';
  }
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code: 'projeto-desconhecido' | 'pasta-nao-encontrada' | 'sessao-desconhecida' | 'sem-claude-id' | 'ja-em-execucao',
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

const TOOLS_TTL_MS = 60_000;

interface Runtime {
  status: SessionStatus;
  alive: boolean;
}

type Record_ = SessionInfoRecord;
type SessionInfoRecord = Omit<SessionInfo, 'status' | 'alive'>;

export class SessionService extends EventEmitter {
  private readonly runtime = new Map<string, Runtime>();
  /** Ids com start/resume em andamento (entre os awaits e o spawn). */
  private readonly starting = new Set<string>();
  /** Incrementado em closeProject: um start em andamento de antes do fechamento é cancelado. */
  private readonly projectEpoch = new Map<string, number>();
  private readonly toolsCache = new Map<EnvId, { at: number; tools: EnvTools }>();
  private readonly now: () => number;

  constructor(private readonly deps: SessionDeps) {
    super();
    this.now = deps.now ?? Date.now;
    deps.watcher.on('status', (id: string, status: SessionStatus) => {
      const rt = this.runtime.get(id);
      if (!rt || !rt.alive || rt.status === status) return;
      rt.status = status;
      this.emitSession(id);
    });
    deps.watcher.on('claude-id', (id: string, claudeId: string) => {
      const rec = this.record(id);
      if (!rec || rec.claudeSessionId === claudeId) return;
      deps.store.update((s) => {
        const r = s.sessions.find((x) => x.id === id);
        if (r) r.claudeSessionId = claudeId;
      });
      this.emitSession(id);
    });
    deps.pty.on('exit', (id: string) => {
      const rt = this.runtime.get(id);
      if (!rt) return;
      rt.alive = false;
      rt.status = 'parado';
      deps.watcher.unwatch(id);
      this.emitSession(id);
    });
  }

  private record(id: string): Record_ | undefined {
    return this.deps.store.get().sessions.find((s) => s.id === id);
  }

  private info(rec: Record_): SessionInfo {
    const rt = this.runtime.get(rec.id);
    return { ...rec, alive: rt?.alive ?? false, status: rt?.alive ? rt.status : 'parado' };
  }

  emitEvent(ev: ServerEvent): void {
    this.emit('event', ev);
  }

  private emitSession(id: string): void {
    const rec = this.record(id);
    if (rec) this.emitEvent({ type: 'session', session: this.info(rec) });
  }

  has(id: string): boolean {
    return !!this.record(id);
  }

  get(id: string): SessionInfo | undefined {
    const rec = this.record(id);
    return rec ? this.info(rec) : undefined;
  }

  list(projectId: string): SessionInfo[] {
    return this.deps.store
      .get()
      .sessions.filter((s) => s.projectId === projectId)
      .map((s) => this.info(s));
  }

  private async tools(env: EnvId): Promise<EnvTools> {
    const hit = this.toolsCache.get(env);
    if (hit && this.now() - hit.at < TOOLS_TTL_MS) return hit.tools;
    const tools = await this.deps.detectTools(env);
    this.toolsCache.set(env, { at: this.now(), tools });
    return tools;
  }

  private async project(projectId: string): Promise<ProjectView> {
    const p = (await this.deps.projects.list()).find((x) => x.id === projectId);
    if (!p) throw new SessionError('projeto não encontrado', 'projeto-desconhecido');
    if (p.missing) throw new SessionError(`pasta do projeto não encontrada: ${p.path}`, 'pasta-nao-encontrada');
    return p;
  }

  private nextTitle(projectId: string, kind: SessionKind): string {
    const base = kind === 'claude' ? 'Claude' : 'Terminal';
    const re = new RegExp(`^${base} (\\d+)$`);
    let max = 0;
    for (const s of this.deps.store.get().sessions) {
      if (s.projectId !== projectId) continue;
      const m = re.exec(s.title);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${base} ${max + 1}`;
  }

  /** Inicia (ou reinicia) o processo de uma sessão. */
  private async start(id: string, project: ProjectView, kind: SessionKind, epoch: number, resumeClaudeId?: string): Promise<void> {
    let claudeArgs: string[] | undefined;
    let statusFile: string | undefined;
    let tools: EnvTools | undefined;
    if (kind === 'claude') tools = await this.tools(project.env);
    // close()/closeProject() podem ter rodado durante os awaits: não criar processo órfão.
    if (!this.record(id) || (this.projectEpoch.get(project.id) ?? 0) !== epoch) {
      throw new SessionError('sessão fechada durante a inicialização', 'sessao-desconhecida');
    }
    if (kind === 'claude') {
      if (!tools?.claude) {
        throw new ToolMissingError('claude', project.env, INSTALL_HINTS.claude[project.env === 'windows' ? 'windows' : 'wsl']);
      }
      const hooks = writeHookSettings(this.deps.config.tempDir, id, project.env);
      statusFile = hooks.statusFile;
      // Nunca reproduzir o histórico de uma execução anterior.
      closeSync(openSync(statusFile, 'w'));
      claudeArgs = ['--settings', hooks.settingsArg, ...(resumeClaudeId ? ['--resume', resumeClaudeId] : [])];
    }
    const launch = this.deps.buildLaunch({ env: project.env, cwd: project.path, kind, claudeArgs });
    this.runtime.set(id, { status: 'parado', alive: true });
    try {
      this.deps.pty.spawn(id, launch, project.env === 'windows' ? project.path : undefined);
    } catch (e) {
      if (!this.deps.pty.isAlive(id)) this.runtime.set(id, { status: 'parado', alive: false });
      throw e;
    }
    if (statusFile) this.deps.watcher.watch(id, statusFile);
  }

  async create(projectId: string, kind: SessionKind, opts: { resumeClaudeId?: string } = {}): Promise<SessionInfo> {
    const epoch = this.projectEpoch.get(projectId) ?? 0;
    const project = await this.project(projectId);
    const id = randomUUID();
    const rec: Record_ = {
      id,
      projectId,
      kind,
      title: this.nextTitle(projectId, kind),
      createdAt: new Date().toISOString(),
      ...(opts.resumeClaudeId ? { claudeSessionId: opts.resumeClaudeId } : {}),
    };
    // Registra antes de iniciar: um exit imediato já encontra a sessão.
    this.deps.store.update((s) => void s.sessions.push(rec));
    try {
      await this.start(id, project, kind, epoch, opts.resumeClaudeId);
    } catch (e) {
      this.runtime.delete(id);
      this.deps.store.update((s) => {
        s.sessions = s.sessions.filter((x) => x.id !== id);
      });
      throw e;
    }
    this.emitSession(id);
    return this.info(rec);
  }

  /** Retoma uma sessão persistida e parada, no mesmo id/aba (claude --resume <id>). */
  async resume(sessionId: string): Promise<SessionInfo> {
    const rec = this.record(sessionId);
    if (!rec) throw new SessionError('sessão não encontrada', 'sessao-desconhecida');
    if (this.runtime.get(sessionId)?.alive || this.starting.has(sessionId)) {
      throw new SessionError('a sessão já está em execução', 'ja-em-execucao');
    }
    if (rec.kind === 'claude' && !rec.claudeSessionId) {
      throw new SessionError('esta sessão ainda não tem um id do Claude para retomar', 'sem-claude-id');
    }
    this.starting.add(sessionId); // síncrono: o segundo resume concorrente perde
    try {
      const epoch = this.projectEpoch.get(rec.projectId) ?? 0;
      const project = await this.project(rec.projectId);
      await this.start(sessionId, project, rec.kind, epoch, rec.claudeSessionId);
    } finally {
      this.starting.delete(sessionId);
    }
    this.emitSession(sessionId);
    return this.info(rec);
  }

  close(id: string): void {
    if (!this.record(id)) return;
    this.runtime.delete(id); // antes do kill: o exit seguinte é ignorado
    this.deps.watcher.unwatch(id);
    this.deps.pty.kill(id);
    this.deps.pty.forget(id);
    this.deps.store.update((s) => {
      s.sessions = s.sessions.filter((x) => x.id !== id);
    });
    this.emitEvent({ type: 'session-removed', id });
  }

  /** Encerra o processo da sessão mantendo o registro (parada, pode ser retomada). */
  private stop(id: string): void {
    const wasRunning = this.runtime.has(id);
    this.runtime.delete(id); // antes do kill: o exit seguinte é ignorado
    this.deps.watcher.unwatch(id);
    this.deps.pty.kill(id);
    this.deps.pty.forget(id);
    if (wasRunning) this.emitSession(id);
  }

  /** Fechar a aba do projeto: encerra os processos, mas as sessões continuam listadas para "Retomar". */
  closeProject(projectId: string): void {
    this.projectEpoch.set(projectId, (this.projectEpoch.get(projectId) ?? 0) + 1);
    for (const s of this.list(projectId)) this.stop(s.id);
  }

  /** Remover o projeto do portal: encerra e apaga as sessões. */
  removeProject(projectId: string): void {
    this.projectEpoch.set(projectId, (this.projectEpoch.get(projectId) ?? 0) + 1);
    for (const s of this.list(projectId)) this.close(s.id);
  }

  /** Anexa um cliente de terminal. `alive` false: sem processo (nada a anexar). */
  attachTerm(
    id: string,
    onData: (d: string) => void,
    onExit: (code: number) => void,
  ): { scrollback: string; alive: boolean; detach(): void } | undefined {
    if (!this.record(id)) return undefined;
    if (!this.runtime.has(id)) return { scrollback: '', alive: false, detach() {} };
    const a = this.deps.pty.attach(id, onData);
    const exitListener = (eid: string, code: number) => {
      if (eid === id) onExit(code);
    };
    this.deps.pty.on('exit', exitListener);
    return {
      scrollback: a.scrollback,
      alive: this.deps.pty.isAlive(id),
      detach: () => {
        a.detach();
        this.deps.pty.off('exit', exitListener);
      },
    };
  }

  write(id: string, data: string): void {
    if (this.deps.pty.isAlive(id)) this.deps.pty.write(id, data);
  }

  resize(id: string, cols: number, rows: number): void {
    if (this.deps.pty.isAlive(id)) this.deps.pty.resize(id, cols, rows);
  }
}
