import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import type { Launch } from './launch.js';

/** Limite do scrollback por processo (2 MB, contado em caracteres). */
export const SCROLLBACK_LIMIT = 2 * 1024 * 1024;

interface Entry {
  proc: pty.IPty;
  scrollback: string;
  listeners: Set<(data: string) => void>;
  exited: boolean;
}

export class PtyManager extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }

  private entries = new Map<string, Entry>();

  /** Para Windows `cwd` é o cwd do pty; para WSL o cwd já está nos args (passe undefined). */
  spawn(id: string, launch: Launch, cwd?: string): void {
    const prev = this.entries.get(id);
    if (prev && !prev.exited) throw new Error(`Processo já em execução: ${id}`);
    const proc = pty.spawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: process.env as Record<string, string>,
    });
    // Reaproveita a entrada do id (mantém os listeners anexados); scrollback recomeça.
    const entry: Entry = prev ?? { proc, scrollback: '', listeners: new Set(), exited: false };
    entry.proc = proc;
    entry.scrollback = '';
    entry.exited = false;
    this.entries.set(id, entry);
    // Só o processo atual do id conta: depois de forget + novo spawn, eventos do antigo são ignorados.
    const current = () => entry.proc === proc && this.entries.get(id) === entry;
    proc.onData((d) => {
      if (current()) this.push(entry, d);
    });
    proc.onExit(({ exitCode }) => {
      if (!current()) return;
      entry.exited = true;
      this.emit('exit', id, exitCode);
    });
  }

  /** Interno: adiciona ao scrollback (limitado) e notifica assinantes. */
  append(id: string, data: string): void {
    this.push(this.get(id), data);
  }

  private push(e: Entry, data: string): void {
    e.scrollback += data;
    if (e.scrollback.length > SCROLLBACK_LIMIT) e.scrollback = e.scrollback.slice(-SCROLLBACK_LIMIT);
    for (const l of [...e.listeners]) {
      try {
        l(data);
      } catch {
        /* um assinante com defeito não afeta os outros */
      }
    }
  }

  isAlive(id: string): boolean {
    const e = this.entries.get(id);
    return !!e && !e.exited;
  }

  forget(id: string): void {
    this.entries.delete(id);
  }

  write(id: string, data: string): void {
    const e = this.get(id);
    if (!e.exited) e.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.get(id);
    if (!e.exited) e.proc.resize(cols, rows);
  }

  kill(id: string): void {
    const e = this.entries.get(id);
    if (!e || e.exited) return;
    try {
      e.proc.kill();
    } catch {
      /* já encerrado */
    }
  }

  /** Encerra todos os processos vivos (desligamento do portal). */
  killAll(): void {
    for (const id of this.entries.keys()) this.kill(id);
  }

  attach(id: string, onData: (data: string) => void): { scrollback: string; detach(): void } {
    const e = this.get(id);
    e.listeners.add(onData);
    return { scrollback: e.scrollback, detach: () => void e.listeners.delete(onData) };
  }

  private get(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Processo desconhecido: ${id}`);
    return e;
  }
}
