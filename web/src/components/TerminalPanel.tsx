import type { SessionInfo } from '@shared';
import { SessionTabs } from './SessionTabs';
import { TerminalView } from './TerminalView';
import { ToolMissingPanel, type ToolMissing } from './ToolMissingPanel';

export interface PaneProps {
  sessions: SessionInfo[];
  activeId: string | null;
  generation: Record<string, number>;
  newLabel: string;
  empty: string;
  missing: ToolMissing | null;
  small?: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onResume: (id: string) => void;
  onDismissMissing: () => void;
}

/** Abas + terminais de um tipo de sessão. Todos os terminais ficam montados; só o ativo é visível. */
export function TerminalPanel(p: PaneProps) {
  const active = p.sessions.find((s) => s.id === p.activeId);
  return (
    <div className={p.small ? 'pane small' : 'pane'}>
      <SessionTabs sessions={p.sessions} activeId={p.activeId} newLabel={p.newLabel} small={p.small}
        onSelect={p.onSelect} onClose={p.onClose} onNew={p.onNew} onResume={p.onResume} />
      <div className="pane-body">
        {p.sessions.map((s) => (
          <div key={`${s.id}:${p.generation[s.id] ?? 0}`} className="term-wrap" style={{ display: s.id === p.activeId && !p.missing ? 'block' : 'none' }}>
            <TerminalView sessionId={s.id} />
          </div>
        ))}
        {active && !active.alive && !p.missing && (
          <div className="dead-banner">
            Sessão parada.
            <button className="btn primary" onClick={() => p.onResume(active.id)}>Retomar</button>
          </div>
        )}
        {p.sessions.length === 0 && !p.missing && <div className="placeholder muted">{p.empty}</div>}
        {p.missing && <ToolMissingPanel info={p.missing} onDismiss={p.onDismissMissing} />}
      </div>
    </div>
  );
}
