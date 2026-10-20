import type { EnvId, EnvTools, Project, ProjectView, SessionInfo } from '@shared';

export interface EnvironmentsInfo {
  envs: EnvTools[];
  roots: { windows: string; wsl: string };
  hints: Record<'claude' | 'gh', { windows: string; wsl: string }>;
}
export interface GhStatus { installed: boolean; loggedIn: boolean; user: string | null; orgs: string[] }
export interface GithubOpts { owner?: string; private: boolean }
export interface CreateResult { project: Project; warnings: string[] }
export interface OpenState { openProjectIds: string[]; activeProjectId: string | null }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const j = await res.json();
      msg = j.message ?? j.error ?? msg;
    } catch { /* corpo vazio */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  projects: () => call<ProjectView[]>('GET', '/api/projects'),
  sessions: (projectId: string) => call<SessionInfo[]>('GET', `/api/projects/${encodeURIComponent(projectId)}/sessions`),
  getOpen: () => call<OpenState>('GET', '/api/open'),
  /** Substitui AMBOS: sempre enviar activeProjectId (omitir limpa). */
  putOpen: (openProjectIds: string[], activeProjectId: string | null) =>
    call<OpenState>('PUT', '/api/open', { openProjectIds, activeProjectId }),
  environments: () => call<EnvironmentsInfo>('GET', '/api/environments'),
  ghStatus: (env: EnvId) => call<GhStatus>('GET', `/api/gh/status?env=${encodeURIComponent(env)}`),
  createProject: (b: { env: EnvId; name: string; baseDir: string; github: false | GithubOpts }) =>
    call<CreateResult>('POST', '/api/projects', b),
  registerProject: (b: { env: EnvId; path: string; github: false | GithubOpts }) =>
    call<CreateResult>('POST', '/api/projects/register', b),
  createGitignore: (id: string) => call<{ ok: true }>('POST', `/api/projects/${encodeURIComponent(id)}/gitignore`),
  removeProject: (id: string) => call<void>('DELETE', `/api/projects/${encodeURIComponent(id)}`),
};
