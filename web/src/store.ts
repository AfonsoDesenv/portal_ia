import { create } from 'zustand';
import type { ProjectView, ServerEvent, SessionInfo, SessionStatus } from '@shared';
import { api, type OpenState } from './api';

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
  /** Seleção de commit por projeto: caminho → marcado. Persiste entre modos. */
  selection: Record<string, Record<string, boolean>>;
  setSelection: (id: string, sel: Record<string, boolean>) => void;
  /** Rascunho da mensagem de commit por projeto (sobrevive à troca de modo). */
  draft: Record<string, string>;
  setDraft: (id: string, text: string) => void;
  /** Última versão do estado de abas do servidor já aplicada (descarta avisos antigos). */
  openVersion: number;
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
  const loadSessions = (id: string) =>
    api.sessions(id).then((l) => set((s) => ({ sessions: { ...s.sessions, [id]: l } }))).catch(() => undefined);

  /**
   * Aplica o estado de abas do servidor. A janela mantém o próprio ativo enquanto ele seguir aberto
   * (`keepActive`), senão adota o do servidor.
   */
  const applyOpen = (o: OpenState, keepActive: boolean) => {
    const prev = get();
    const openIds = o.openProjectIds;
    const fallback = o.activeProjectId && openIds.includes(o.activeProjectId) ? o.activeProjectId : (openIds[openIds.length - 1] ?? null);
    const activeId = keepActive && prev.activeId && openIds.includes(prev.activeId) ? prev.activeId : fallback;
    set({ openIds, activeId });
    for (const id of openIds) if (!prev.openIds.includes(id)) void loadSessions(id);
    if (openIds.some((id) => !prev.projects.some((p) => p.id === id))) void get().refreshProjects().catch(() => undefined);
  };

  /** Aplica um estado do servidor só se for mais novo que o último aplicado. */
  const applyServerOpen = (o: OpenState) => {
    if (o.version <= get().openVersion) return;
    set({ openVersion: o.version });
    applyOpen(o, true);
  };

  // Enquanto esta janela tem um pedido de abas em andamento, os avisos que chegam são guardados
  // (só o mais novo) e aplicados junto com a resposta: um aviso de antes do pedido não desfaz a
  // mudança otimista que a janela já mostrou.
  let pendingOpen = 0;
  let bufferedOpen: OpenState | null = null;
  const newerOpen = (a: OpenState | null, b: OpenState | null) => (!a ? b : !b ? a : b.version > a.version ? b : a);
  const receiveOpen = (o: OpenState) => {
    if (pendingOpen > 0) bufferedOpen = newerOpen(bufferedOpen, o);
    else applyServerOpen(o);
  };
  const mutateOpen = async (req: () => Promise<OpenState>) => {
    pendingOpen++;
    let res: OpenState | null = null;
    try {
      res = await req();
    } catch {
      /* offline: estado local fica */
    } finally {
      pendingOpen--;
    }
    bufferedOpen = newerOpen(bufferedOpen, res);
    if (pendingOpen === 0 && bufferedOpen) {
      const o = bufferedOpen;
      bufferedOpen = null;
      applyServerOpen(o);
    }
  };

  return {
    projects: [],
    openIds: [],
    activeId: null,
    sessions: {},
    mode: {},
    generation: {},
    gitTick: {},
    selection: {},
    draft: {},
    setDraft(id, text) {
      set((s) => ({ draft: { ...s.draft, [id]: text } }));
    },
    setSelection(id, sel) {
      set((s) => ({ selection: { ...s.selection, [id]: sel } }));
    },
    openVersion: -1,
    loaded: false,

    async load() {
      const [projects, open] = await Promise.all([api.projects(), api.getOpen()]);
      const ids = new Set(projects.map((p) => p.id));
      const openIds = open.openProjectIds.filter((i) => ids.has(i));
      const activeId = open.activeProjectId && openIds.includes(open.activeProjectId) ? open.activeProjectId : null;
      // Recarga (ex.: reconexão após reinício do servidor): adota a versão atual sem comparar.
      set({ projects, openIds, activeId, openVersion: open.version, loaded: true });
      const lists = await Promise.all(openIds.map((i) => api.sessions(i).catch(() => [] as SessionInfo[])));
      set({ sessions: Object.fromEntries(openIds.map((i, n) => [i, lists[n]])) });
    },

    async refreshProjects() {
      set({ projects: await api.projects() });
    },

    async openProject(id) {
      const wasOpen = get().openIds.includes(id);
      set({ openIds: wasOpen ? get().openIds : [...get().openIds, id], activeId: id });
      if (!wasOpen) void loadSessions(id);
      await mutateOpen(() => api.openProject(id));
    },

    async activate(id) {
      set({ activeId: id });
      await mutateOpen(() => api.putOpen(id));
    },

    async closeProject(id) {
      const openIds = get().openIds.filter((x) => x !== id);
      const activeId = get().activeId === id ? (openIds[openIds.length - 1] ?? null) : get().activeId;
      set({ openIds, activeId });
      await mutateOpen(() => api.closeProject(id));
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
      if (e.type === 'open-changed') {
        receiveOpen(e);
      } else if (e.type === 'git-changed') {
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
