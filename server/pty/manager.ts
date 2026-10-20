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
    const entry: Entry = { proc, scrollback: '', listeners: new Set(), exited: false };
    this.entries.set(id, entry);
    proc.onData((d) => this.append(id, d));
    proc.onExit(({ exitCode }) => {
      entry.exited = true;
      this.emit('exit', id, exitCode);
    });
  }

  /** Interno: adiciona ao scrollback (limitado) e notifica assinantes. */
  append(id: string, data: string): void {
    const e = this.get(id);
    e.scrollback += data;
    if (e.scrollback.length > SCROLLBACK_LIMIT) e.scrollback = e.scrollback.slice(-SCROLLBACK_LIMIT);
    for (const l of e.listeners) l(data);
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
