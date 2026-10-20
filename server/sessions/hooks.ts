import { EventEmitter } from 'node:events';
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { toWslPath } from '../env/paths.js';
import type { EnvId, SessionStatus } from '../types.js';

const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop'] as const;

/** Script que anexa o stdin como UMA linha ao arquivo de status. Nunca falha nem escreve no stdout. */
const APPEND_SCRIPT = String.raw`import { appendFileSync } from 'node:fs';
const file = process.argv[2];
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => {
  try {
    let line;
    try { line = JSON.stringify(JSON.parse(data)); } catch { line = data.replace(/\r?\n/g, ' ').trim(); }
    if (line && file) appendFileSync(file, line + '\n');
  } catch {}
  process.exit(0);
});
process.stdin.on('error', () => process.exit(0));
`;

const BS = String.fromCharCode(92);
const fwd = (p: string) => p.split(BS).join('/');
const shQuote = (s: string) => `'${s.split("'").join(`'${BS}''`)}'`;

export function writeHookSettings(
  tempDir: string,
  sessionId: string,
  env: EnvId,
): { settingsArg: string; statusFile: string } {
  const hooksDir = join(tempDir, 'hooks');
  const statusDir = join(tempDir, 'status');
  mkdirSync(hooksDir, { recursive: true });
  mkdirSync(statusDir, { recursive: true });
  const statusFile = join(statusDir, `${sessionId}.jsonl`);
  const settingsFile = join(hooksDir, `${sessionId}.json`);
  const appendScript = join(hooksDir, 'append.mjs');
  writeFileSync(appendScript, APPEND_SCRIPT);

  const command =
    env === 'windows'
      ? `node "${fwd(appendScript)}" "${fwd(statusFile)}"`
      : `sh -c 'cat >> "$0"; echo >> "$0"' ${shQuote(toWslPath(statusFile))}`;

  const hooks: Record<string, unknown> = {};
  for (const ev of HOOK_EVENTS) {
    hooks[ev] = [{ ...(ev === 'PreToolUse' ? { matcher: '*' } : {}), hooks: [{ type: 'command', command }] }];
  }
  writeFileSync(settingsFile, JSON.stringify({ hooks }, null, 2));
  return { settingsArg: env === 'windows' ? settingsFile : toWslPath(settingsFile), statusFile };
}

export function eventToStatus(hookEventName: string): SessionStatus | null {
  switch (hookEventName) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
      return 'trabalhando';
    case 'Stop':
    case 'Notification':
      return 'esperando';
    default:
      return null;
  }
}

interface Watched {
  file: string;
  offset: number;
  pending: string;
  fsw?: FSWatcher;
  timer: NodeJS.Timeout;
}

export class StatusWatcher extends EventEmitter {
  private watched = new Map<string, Watched>();

  watch(sessionId: string, statusFile: string): void {
    this.unwatch(sessionId);
    const w: Watched = { file: statusFile, offset: 0, pending: '', timer: undefined as never };
    try {
      w.fsw = watch(statusFile, () => this.read(sessionId));
      w.fsw.on('error', () => {});
    } catch {
      // arquivo ainda não existe: o polling cobre
    }
    w.timer = setInterval(() => {
      if (!w.fsw && existsSync(statusFile)) {
        try {
          w.fsw = watch(statusFile, () => this.read(sessionId));
          w.fsw.on('error', () => {});
        } catch {}
      }
      this.read(sessionId);
    }, 1000);
    this.watched.set(sessionId, w);
    this.read(sessionId);
  }

  unwatch(sessionId: string): void {
    const w = this.watched.get(sessionId);
    if (!w) return;
    clearInterval(w.timer);
    w.fsw?.close();
    this.watched.delete(sessionId);
  }

  private read(sessionId: string): void {
    const w = this.watched.get(sessionId);
    if (!w) return;
    let size: number;
    try {
      size = statSync(w.file).size;
    } catch {
      return;
    }
    if (size < w.offset) {
      w.offset = 0;
      w.pending = '';
    }
    if (size === w.offset) return;
    const buf = Buffer.alloc(size - w.offset);
    let fd: number | undefined;
    let n = 0;
    try {
      fd = openSync(w.file, 'r');
      n = readSync(fd, buf, 0, buf.length, w.offset);
    } catch {
      return;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    w.offset += n;
    w.pending += buf.subarray(0, n).toString('utf8');
    const parts = w.pending.split('\n');
    w.pending = parts.pop() ?? '';
    for (const raw of parts) {
      const line = raw.trim();
      if (!line) continue;
      let obj: { hook_event_name?: unknown; session_id?: unknown };
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof obj.session_id === 'string' && obj.session_id) this.emit('claude-id', sessionId, obj.session_id);
      if (typeof obj.hook_event_name === 'string') {
        const st = eventToStatus(obj.hook_event_name);
        if (st) this.emit('status', sessionId, st);
      }
    }
  }
}
