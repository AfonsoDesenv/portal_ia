import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Project, SessionInfo } from '../types.js';

export interface State {
  projects: Project[];
  openProjectIds: string[];
  sessions: Omit<SessionInfo, 'status' | 'alive'>[];
  activeProjectId?: string;
}

function emptyState(): State {
  return { projects: [], openProjectIds: [], sessions: [] };
}

export class Store {
  private constructor(
    private readonly file: string,
    private state: State,
  ) {}

  static open(file: string): Store {
    if (!existsSync(file)) return new Store(file, emptyState());
    const raw = readFileSync(file, 'utf8');
    try {
      return new Store(file, JSON.parse(raw) as State);
    } catch {
      const backup = `${file}.corrompido-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      renameSync(file, backup);
      return new Store(file, emptyState());
    }
  }

  get(): State {
    return this.state;
  }

  update(fn: (s: State) => void): void {
    fn(this.state);
    this.save();
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}
