import { create } from 'zustand';
import type { ProjectView, ServerEvent, SessionInfo, SessionStatus } from '@shared';
import { api } from './api';

export function aggregateStatus(s: SessionInfo[]): SessionStatus {
  if (s.some((x) => x.status === 'esperando')) return 'esperando';
  if (s.some((x) => x.status === 'trabalhando')) return 'trabalhando';
  return 'parado';
}

export type Mode = 'trabalho' | 'review';

export interface AppState {
  projects: ProjectView[];
  openIds: string[];
  activeId: string | null;
  sessions: Record<string, SessionInfo[]>;
  mode: Record<string, Mode>;
  /** Contador por sessão, incrementado quando ela volta a viver (retomada): o terminal reconecta. */
  generation: Record<string, number>;
  /** Contador por projeto, incrementado em git-changed. */
  gitTick: Record<string, number>;
  loaded: boolean;
  load: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  closeProject: (id: string) => Promise<void>;
  setMode: (id: string, m: Mode) => void;
  applyEvent: (e: ServerEvent) => void;
  /** Fecha o projeto pedindo confirmação se houver sessão trabalhando. */
  requestCloseProject: (id: string) => Promise<void>;
}

export const useApp = create<AppState>((set, get) => {
  const persist = (openIds: string[], activeId: string | null) =>
    api.putOpen(openIds, activeId).catch(() => undefined);

  return {
    projects: [],
    openIds: [],
    activeId: null,
    sessions: {},
    mode: {},
    generation: {},
    gitTick: {},
    loaded: false,

    async load() {
      const [projects, open] = await Promise.all([api.projects(), api.getOpen()]);
      const ids = new Set(projects.map((p) => p.id));
      const openIds = open.openProjectIds.filter((i) => ids.has(i));
      const activeId = open.activeProjectId && openIds.includes(open.activeProjectId) ? open.activeProjectId : null;
      set({ projects, openIds, activeId, loaded: true });
      const lists = await Promise.all(openIds.map((i) => api.sessions(i).catch(() => [] as SessionInfo[])));
      set({ sessions: Object.fromEntries(openIds.map((i, n) => [i, lists[n]])) });
    },

    async refreshProjects() {
      set({ projects: await api.projects() });
    },

    async openProject(id) {
      const openIds = get().openIds.includes(id) ? get().openIds : [...get().openIds, id];
      set({ openIds, activeId: id });
      await persist(openIds, id);
      api.sessions(id).then((l) => set((s) => ({ sessions: { ...s.sessions, [id]: l } }))).catch(() => undefined);
    },

    async activate(id) {
      set({ activeId: id });
      await persist(get().openIds, id);
    },

    async closeProject(id) {
      const openIds = get().openIds.filter((x) => x !== id);
      const activeId = get().activeId === id ? (openIds[openIds.length - 1] ?? null) : get().activeId;
      set({ openIds, activeId });
      await persist(openIds, activeId);
    },

    setMode(id, m) {
      set((s) => ({ mode: { ...s.mode, [id]: m } }));
    },

    async requestCloseProject(id) {
      const busy = (get().sessions[id] ?? []).some((x) => x.status === 'trabalhando');
      if (busy && !window.confirm('Há sessões trabalhando neste projeto. Fechar mesmo assim?')) return;
      await get().closeProject(id);
    },

    applyEvent(e) {
      if (e.type === 'git-changed') {
        set((s) => ({ gitTick: { ...s.gitTick, [e.projectId]: (s.gitTick[e.projectId] ?? 0) + 1 } }));
      } else if (e.type === 'session') {
        const sess = e.session;
        set((s) => {
          const list = s.sessions[sess.projectId] ?? [];
          const old = list.find((x) => x.id === sess.id);
          const next = old ? list.map((x) => (x.id === sess.id ? sess : x)) : [...list, sess];
          const revived = old && !old.alive && sess.alive;
          return {
            sessions: { ...s.sessions, [sess.projectId]: next },
            generation: revived ? { ...s.generation, [sess.id]: (s.generation[sess.id] ?? 0) + 1 } : s.generation,
          };
        });
      } else if (e.type === 'session-removed') {
        set((s) => ({
          sessions: Object.fromEntries(Object.entries(s.sessions).map(([k, v]) => [k, v.filter((x) => x.id !== e.id)])),
        }));
      }
    },
  };
});
