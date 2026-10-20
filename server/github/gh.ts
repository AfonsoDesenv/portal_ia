import type { Runner } from '../env/exec.js';
import type { EnvId } from '../types.js';

export interface GhStatus {
  installed: boolean;
  loggedIn: boolean;
  user?: string;
}

export interface CreateRepoOptions {
  owner?: string;
  name: string;
  private: boolean;
}

export class GitHub {
  constructor(private readonly run: Runner) {}

  /** No WSL roda via shell de login (PATH do ~/.profile, como detectTools); args vão como "$@". */
  private gh(env: EnvId, cwd: string | null, args: string[]) {
    return env === 'windows'
      ? this.run(env, cwd, 'gh', args)
      : this.run(env, cwd, 'bash', ['-lc', 'exec gh "$@"', 'gh', ...args]);
  }

  async status(env: EnvId): Promise<GhStatus> {
    const version = await this.gh(env, null, ['--version']);
    if (version.code !== 0) return { installed: false, loggedIn: false };

    const auth = await this.gh(env, null, ['auth', 'status']);
    if (auth.code !== 0) return { installed: true, loggedIn: false };

    const me = await this.gh(env, null, ['api', 'user', '--jq', '.login']);
    const user = me.code === 0 ? me.stdout.trim() : '';
    return user ? { installed: true, loggedIn: true, user } : { installed: true, loggedIn: true };
  }

  async orgs(env: EnvId): Promise<string[]> {
    const res = await this.gh(env, null, ['api', 'user/orgs', '--jq', '.[].login']);
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Falha ao listar organizações do GitHub');
    return res.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async createRepo(env: EnvId, cwd: string, opts: CreateRepoOptions): Promise<string> {
    const target = opts.owner ? `${opts.owner}/${opts.name}` : opts.name;
    const args = [
      'repo', 'create', target,
      opts.private ? '--private' : '--public',
      '--source', '.',
      '--remote', 'origin',
    ];
    const created = await this.gh(env, cwd, args);
    if (created.code !== 0) {
      throw new Error(created.stderr.trim() || 'Falha ao criar repositório no GitHub');
    }
    const remote = await this.run(env, cwd, 'git', ['remote', 'get-url', 'origin']);
    if (remote.code !== 0) {
      throw new Error(remote.stderr.trim() || 'Falha ao ler a URL do remoto origin');
    }
    return remote.stdout.trim();
  }
}
