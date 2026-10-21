import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectView as Project, SessionInfo, SessionKind } from '@shared';
import { ApiError, api } from '../api';
import { useApp } from '../store';
import { TopBar } from './TopBar';
import { TerminalPanel } from './TerminalPanel';
import type { ToolMissing } from './ToolMissingPanel';
import { ChangesPanel } from './ChangesPanel';

const ReviewView = lazy(() => import('./ReviewView').then((m) => ({ default: m.ReviewView })));

const NONE: SessionInfo[] = [];

export function ProjectView({ project, visible }: { project: Project; visible: boolean }) {
  const sessions = useApp((s) => s.sessions[project.id]) ?? NONE;
  const generation = useApp((s) => s.generation);
  const mode = useApp((s) => s.mode[project.id]) ?? 'trabalho';
  const applyEvent = useApp((s) => s.applyEvent);
  const [sel, setSel] = useState<Record<SessionKind, string | null>>({ claude: null, shell: null });
  const [missing, setMissing] = useState<Record<SessionKind, ToolMissing | null>>({ claude: null, shell: null });
  const [error, setError] = useState('');
  const [split, setSplit] = useState(0.3); // fração da altura para os terminais
  const centerRef = useRef<HTMLDivElement>(null);
  // Os terminais do Claude são renderizados uma única vez dentro deste host; ele é movido entre o
  // painel de trabalho e a barra "Claude" do Review, então o TerminalView/WS/xterm nunca é recriado.
  const claudeHost = useMemo(() => {
    const d = document.createElement('div');
    d.className = 'claude-host';
    return d;
  }, []);
  const workSlot = useRef<HTMLDivElement>(null);
  const attachClaude = useCallback((el: HTMLDivElement | null) => { el?.appendChild(claudeHost); }, [claudeHost]);
  useLayoutEffect(() => {
    if (mode === 'trabalho') workSlot.current?.appendChild(claudeHost);
  }, [mode, claudeHost]);
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []); // desmontar no meio do arrasto

  const claude = sessions.filter((s) => s.kind === 'claude');
  const shells = sessions.filter((s) => s.kind === 'shell');
  const activeOf = (kind: SessionKind, list: SessionInfo[]) =>
    list.find((s) => s.id === sel[kind])?.id ?? list[0]?.id ?? null;

  const handleErr = useCallback((kind: SessionKind, e: unknown) => {
    if (e instanceof ApiError && e.status === 422 && e.body.erro === 'ferramenta-ausente') {
      setMissing((m) => ({ ...m, [kind]: { ferramenta: String(e.body.ferramenta), dica: String(e.body.dica), env: project.env } }));
    } else {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project.env]);

  const create = async (kind: SessionKind) => {
    setError('');
    setMissing((m) => ({ ...m, [kind]: null }));
    try {
      const s = await api.createSession(project.id, kind);
      applyEvent({ type: 'session', session: s });
      setSel((x) => ({ ...x, [kind]: s.id }));
    } catch (e) {
      handleErr(kind, e);
    }
  };
  const resume = async (kind: SessionKind, id: string) => {
    setError('');
    setMissing((m) => ({ ...m, [kind]: null }));
    try {
      applyEvent({ type: 'session', session: await api.resumeSession(id) });
    } catch (e) {
      handleErr(kind, e);
    }
  };
  const close = async (kind: SessionKind, id: string) => {
    try {
      await api.closeSession(id);
      applyEvent({ type: 'session-removed', id });
    } catch (e) {
      handleErr(kind, e);
    }
  };
  const select = (kind: SessionKind, id: string) => {
    setMissing((m) => ({ ...m, [kind]: null }));
    setSel((x) => ({ ...x, [kind]: id }));
  };

  const startDrag = (ev: React.PointerEvent) => {
    ev.preventDefault();
    const box = centerRef.current;
    if (!box) return;
    const move = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      setSplit(Math.min(0.8, Math.max(0.1, (r.bottom - e.clientY) / r.height)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      stopDrag.current = null;
    };
    stopDrag.current?.();
    stopDrag.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const pane = (kind: SessionKind, list: SessionInfo[], newLabel: string, empty: string, small?: boolean) => (
    <TerminalPanel
      sessions={list} activeId={activeOf(kind, list)} generation={generation} newLabel={newLabel} empty={empty} small={small}
      missing={missing[kind]}
      onSelect={(id) => select(kind, id)} onClose={(id) => close(kind, id)} onNew={() => create(kind)}
      onResume={(id) => resume(kind, id)} onDismissMissing={() => setMissing((m) => ({ ...m, [kind]: null }))}
    />
  );

  return (
    <section className="project" style={{ display: visible ? 'flex' : 'none' }}>
      <TopBar project={project} mode={mode} onError={setError} />
      {project.missing && <div className="notice warn">Pasta do projeto não encontrada: {project.path}</div>}
      {error && <div className="notice error" onClick={() => setError('')}>{error}</div>}
      <div className="work" style={{ display: mode === 'trabalho' ? 'flex' : 'none' }}>
        <div className="center" ref={centerRef}>
          <div className="center-claude" style={{ flex: `${1 - split} 1 0` }}>
            <div className="claude-work-slot" ref={workSlot} />
            {createPortal(pane('claude', claude, '+ nova sessão', 'Nenhuma sessão do Claude. Clique em "+ nova sessão".'), claudeHost)}
          </div>
          <div className="splitter" onPointerDown={startDrag} role="separator" aria-orientation="horizontal" />
          <div className="center-shell" style={{ flex: `${split} 1 0` }}>
            {pane('shell', shells, '+ terminal', 'Nenhum terminal aberto.', true)}
          </div>
        </div>
        <aside className="changes-slot">
          {mode === 'trabalho' && <ChangesPanel projectId={project.id} compact={false} />}
        </aside>
      </div>
      {mode === 'review' && (
        <Suspense fallback={<div className="placeholder muted">Carregando review…</div>}>
          <ReviewView projectId={project.id} attachClaude={attachClaude} />
        </Suspense>
      )}
    </section>
  );
}
