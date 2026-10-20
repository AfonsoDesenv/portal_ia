import type { SessionInfo } from '@shared';
import { StatusDot } from './StatusDot';

interface Props {
  sessions: SessionInfo[];
  activeId: string | null;
  newLabel: string;
  small?: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onResume: (id: string) => void;
}

export function SessionTabs({ sessions, activeId, newLabel, small, onSelect, onClose, onNew, onResume }: Props) {
  return (
    <div className={small ? 'tabs small' : 'tabs'} role="tablist">
      {sessions.map((s) => (
        <div key={s.id} role="tab" aria-selected={s.id === activeId} className={s.id === activeId ? 'tab active' : 'tab'}>
          <button className="tab-main" onClick={() => onSelect(s.id)}>
            <StatusDot status={s.alive ? s.status : 'parado'} />
            <span className="tab-title">{s.title}</span>
          </button>
          {!s.alive && <button className="btn tab-resume" onClick={() => onResume(s.id)}>Retomar</button>}
          <button className="close" aria-label={`Fechar ${s.title}`} onClick={() => onClose(s.id)}>×</button>
        </div>
      ))}
      <button className="btn tab-new" onClick={onNew}>{newLabel}</button>
    </div>
  );
}
