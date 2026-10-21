export type EnvId = 'windows' | `wsl:${string}`;
export interface Project { id: string; name: string; env: EnvId; path: string; remoteUrl?: string; createdAt: string; }
export interface ProjectView extends Project { missing: boolean; }
export type SessionKind = 'claude' | 'shell';
export type SessionStatus = 'trabalhando' | 'esperando' | 'parado';
export interface SessionInfo { id: string; projectId: string; kind: SessionKind; title: string;
  status: SessionStatus; alive: boolean; claudeSessionId?: string; createdAt: string; }
export interface ChangedFile { path: string; oldPath?: string; index: string; worktree: string;
  added: number; removed: number; binary: boolean; }
export interface EnvTools { env: EnvId; git: boolean; claude: boolean; gh: boolean; ghLoggedIn: boolean; }
export interface ExecResult { code: number; stdout: string; stderr: string; }
/** Abas abertas. `version` cresce a cada mudança (reinicia com o servidor). */
export interface OpenState { openProjectIds: string[]; activeProjectId: string | null; version: number; }
export type ServerEvent =
  | { type: 'session'; session: SessionInfo }
  | { type: 'session-removed'; id: string }
  | { type: 'git-changed'; projectId: string }
  | ({ type: 'open-changed' } & OpenState);
