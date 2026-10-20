import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChangedFile, EnvId } from '../types.js';
import type { Runner } from '../env/exec.js';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

export class Git {
  constructor(
    private run: Runner,
    private env: EnvId,
    private cwd: string,
  ) {}

  private raw(args: string[], input?: string) {
    return this.run(this.env, this.cwd, 'git', ['--literal-pathspecs', '-c', 'core.quotepath=false', ...args], input === undefined ? undefined : { input });
  }

  private async ok(args: string[]): Promise<string> {
    const r = await this.raw(args);
    if (r.code !== 0) throw new GitError(r.stderr.trim() || `git ${args[0]} falhou (código ${r.code})`);
    return r.stdout;
  }

  async isRepo(): Promise<boolean> {
    const r = await this.raw(['rev-parse', '--is-inside-work-tree']);
    return r.code === 0 && r.stdout.trim() === 'true';
  }

  async init(): Promise<void> {
    await this.ok(['init', '-b', 'main']);
  }

  async currentBranch(): Promise<string | null> {
    const r = await this.raw(['symbolic-ref', '--short', 'HEAD']);
    return r.code === 0 ? r.stdout.trim() || null : null;
  }

  async branches(): Promise<{ local: string[]; remote: string[] }> {
    const list = async (ref: string) =>
      (await this.ok(['for-each-ref', '--format=%(refname:short)', ref]))
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    const local = await list('refs/heads');
    const remote = (await list('refs/remotes')).filter((b) => !b.endsWith('/HEAD') && b.includes('/'));
    return { local, remote };
  }

  async createBranch(name: string, from: string): Promise<void> {
    await this.ok(['switch', '-c', name, from]);
  }

  /** Troca para uma branch LOCAL. Falhas do git (ex.: árvore suja) viram GitError com a mensagem do git. */
  async checkout(branch: string): Promise<void> {
    if (!branch.trim() || branch.startsWith('-')) throw new GitError('nome de branch inválido');
    await this.ok(['switch', branch]);
  }

  private async hasHead(): Promise<boolean> {
    return (await this.raw(['rev-parse', '--verify', '-q', 'HEAD'])).code === 0;
  }

  private async readWorking(path: string): Promise<string> {
    if (this.env === 'windows') return readFile(join(this.cwd, path), 'utf8');
    const r = await this.run(this.env, this.cwd, 'cat', ['--', path]);
    if (r.code !== 0) throw new GitError(r.stderr.trim() || `não foi possível ler ${path}`);
    return r.stdout;
  }

  async status(): Promise<ChangedFile[]> {
    const st = await this.ok(['status', '--porcelain=v1', '-z', '-uall']);
    const base = (await this.hasHead()) ? 'HEAD' : EMPTY_TREE;
    const ns = await this.ok(['diff', '--numstat', '-z', base]);

    // numstat: "add\tdel\tpath\0" ou, em rename, "add\tdel\t\0old\0new\0"
    const stats = new Map<string, { added: number; removed: number; binary: boolean }>();
    const nt = ns.split('\0');
    for (let i = 0; i < nt.length; i++) {
      const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(nt[i]);
      if (!m) continue;
      let p = m[3];
      if (p === '') {
        p = nt[i + 2] ?? '';
        i += 2;
      }
      const binary = m[1] === '-';
      stats.set(p, { added: binary ? 0 : +m[1], removed: binary ? 0 : +m[2], binary });
    }

    const out: ChangedFile[] = [];
    const t = st.split('\0');
    for (let i = 0; i < t.length; i++) {
      const e = t[i];
      if (e.length < 4) continue;
      const index = e[0];
      const worktree = e[1];
      const path = e.slice(3);
      let oldPath: string | undefined;
      if (index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C') oldPath = t[++i];
      let s = stats.get(path);
      if (!s && index === '?' && worktree === '?') {
        s = { added: 0, removed: 0, binary: false };
        try {
          const c = await this.readWorking(path);
          if (c.includes('\0')) s.binary = true;
          else s.added = c === '' ? 0 : c.split('\n').length - (c.endsWith('\n') ? 1 : 0);
        } catch {
          /* ilegível: mantém zeros */
        }
      }
      s ??= { added: 0, removed: 0, binary: false };
      out.push({ path, ...(oldPath ? { oldPath } : {}), index, worktree, ...s });
    }
    return out;
  }

  async fileVersions(path: string): Promise<{ original: string; modified: string; binary: boolean }> {
    const show = await this.raw(['show', `HEAD:${path}`]);
    const original = show.code === 0 ? show.stdout : '';
    let modified = '';
    try {
      modified = await this.readWorking(path);
    } catch {
      modified = ''; // arquivo removido
    }
    const binary = original.includes('\0') || modified.includes('\0') || (await this.numstatBinary(path));
    return { original: binary ? '' : original, modified: binary ? '' : modified, binary };
  }

  private async numstatBinary(path: string): Promise<boolean> {
    const base = (await this.hasHead()) ? 'HEAD' : EMPTY_TREE;
    const r = await this.raw(['diff', '--numstat', '-z', base, '--', path]);
    return r.code === 0 && r.stdout.startsWith('-\t-\t');
  }

  async commit(files: string[], message: string): Promise<string> {
    if (files.length === 0) throw new GitError('nenhum arquivo selecionado');
    const added = await this.raw(['add', '-A', '--', ...files]);
    if (added.code !== 0) {
      // Renomeação já indexada: o caminho antigo não existe mais no índice nem na pasta e o `add` recusa
      // o pathspec. Adiciona um a um; caminho realmente inválido falha no commit logo abaixo.
      for (const f of files) await this.raw(['add', '-A', '--', f]);
    }
    await this.ok(['commit', '-m', message, '--', ...files]);
    return (await this.ok(['rev-parse', 'HEAD'])).trim();
  }

  async push(): Promise<void> {
    const remotes = (await this.ok(['remote'])).split('\n').map((s) => s.trim()).filter(Boolean);
    if (remotes.length === 0) throw new GitError('projeto sem remoto');
    const branch = await this.currentBranch();
    if (!branch) throw new GitError('sem branch atual (HEAD desanexado)');
    const up = await this.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (up.code === 0) await this.ok(['push']);
    else await this.ok(['push', '-u', remotes.includes('origin') ? 'origin' : remotes[0], branch]);
  }

  async setRemote(url: string): Promise<void> {
    const has = (await this.raw(['remote', 'get-url', 'origin'])).code === 0;
    await this.ok(has ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
  }
}
