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
  loaded: boolean;
  load: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  closeProject: (id: string) => Promise<void>;
  setMode: (id: string, m: Mode) => void;
  applyEvent: (e: ServerEvent) => void;
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

    applyEvent(e) {
      if (e.type === 'session') {
        const sess = e.session;
        set((s) => {
          const list = s.sessions[sess.projectId] ?? [];
          const next = list.some((x) => x.id === sess.id) ? list.map((x) => (x.id === sess.id ? sess : x)) : [...list, sess];
          return { sessions: { ...s.sessions, [sess.projectId]: next } };
        });
      } else if (e.type === 'session-removed') {
        set((s) => ({
          sessions: Object.fromEntries(Object.entries(s.sessions).map(([k, v]) => [k, v.filter((x) => x.id !== e.id)])),
        }));
      }
    },
  };
});
