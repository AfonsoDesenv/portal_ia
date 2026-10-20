import type { ChangedFile, EnvId, EnvTools, Project, ProjectView, SessionInfo, SessionKind } from '@shared';

export interface EnvironmentsInfo {
  envs: EnvTools[];
  roots: { windows: string; wsl: string };
  hints: Record<'claude' | 'gh', { windows: string; wsl: string }>;
}
export interface GhStatus { installed: boolean; loggedIn: boolean; user: string | null; orgs: string[] }
export interface GithubOpts { owner?: string; private: boolean }
export interface CreateResult { project: Project; warnings: string[] }
export interface OpenState { openProjectIds: string[]; activeProjectId: string | null }

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) {
    super(message);
  }
}
export interface GitStatus { branch: string | null; files: ChangedFile[] }
export interface FileVersions { original: string; modified: string; binary: boolean }
export interface CommitResult { hash: string; pushed: boolean; erroPush?: string }
export interface BranchesInfo { current: string | null; local: string[]; remote: string[] }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    let body: Record<string, unknown> = {};
    try {
      body = await res.json();
      msg = String(body.mensagem ?? body.message ?? body.erro ?? body.error ?? msg);
    } catch { /* corpo vazio */ }
    throw new ApiError(msg, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  projects: () => call<ProjectView[]>('GET', '/api/projects'),
  sessions: (projectId: string) => call<SessionInfo[]>('GET', `/api/projects/${encodeURIComponent(projectId)}/sessions`),
  getOpen: () => call<OpenState>('GET', '/api/open'),
  /** Só troca o projeto ativo (null limpa). Nunca abre nem fecha projetos. */
  putOpen: (activeProjectId: string | null) => call<OpenState>('PUT', '/api/open', { activeProjectId }),
  /** Abre (se preciso) e ativa o projeto. */
  openProject: (id: string) => call<OpenState>('POST', `/api/projects/${encodeURIComponent(id)}/open`),
  /** Fecha a aba do projeto: encerra os processos, as sessões ficam para "Retomar". */
  closeProject: (id: string) => call<OpenState>('POST', `/api/projects/${encodeURIComponent(id)}/close`),
  environments: () => call<EnvironmentsInfo>('GET', '/api/environments'),
  ghStatus: (env: EnvId) => call<GhStatus>('GET', `/api/gh/status?env=${encodeURIComponent(env)}`),
  createProject: (b: { env: EnvId; name: string; baseDir: string; github: false | GithubOpts }) =>
    call<CreateResult>('POST', '/api/projects', b),
  registerProject: (b: { env: EnvId; path: string; github: false | GithubOpts }) =>
    call<CreateResult>('POST', '/api/projects/register', b),
  createGitignore: (id: string) => call<{ ok: true }>('POST', `/api/projects/${encodeURIComponent(id)}/gitignore`),
  createSession: (projectId: string, kind: SessionKind) =>
    call<SessionInfo>('POST', `/api/projects/${encodeURIComponent(projectId)}/sessions`, { kind }),
  resumeSession: (id: string) => call<SessionInfo>('POST', `/api/sessions/${encodeURIComponent(id)}/resume`),
  closeSession: (id: string) => call<void>('DELETE', `/api/sessions/${encodeURIComponent(id)}`),
  branches: (projectId: string) => call<BranchesInfo>('GET', `/api/projects/${encodeURIComponent(projectId)}/git/branches`),
  createBranch: (projectId: string, name: string, from: string) =>
    call<{ branch: string }>('POST', `/api/projects/${encodeURIComponent(projectId)}/git/branches`, { name, from }),
  checkout: (projectId: string, branch: string) =>
    call<{ branch: string }>('POST', `/api/projects/${encodeURIComponent(projectId)}/git/checkout`, { branch }),
  gitStatus: (projectId: string) => call<GitStatus>('GET', `/api/projects/${encodeURIComponent(projectId)}/git/status`),
  gitFile: (projectId: string, path: string) =>
    call<FileVersions>('GET', `/api/projects/${encodeURIComponent(projectId)}/git/file?path=${encodeURIComponent(path)}`),
  commit: (projectId: string, b: { files: string[]; message: string; push: boolean }) =>
    call<CommitResult>('POST', `/api/projects/${encodeURIComponent(projectId)}/git/commit`, b),
  openVsCode: (projectId: string) => call<{ ok: true }>('POST', `/api/projects/${encodeURIComponent(projectId)}/vscode`),
  removeProject: (id: string) => call<void>('DELETE', `/api/projects/${encodeURIComponent(id)}`),
};
