import { useApp, aggregateStatus } from '../store';
import { StatusDot } from './StatusDot';

export function Sidebar({ onNew, onQuick }: { onNew: () => void; onQuick: () => void }) {
  const { projects, openIds, activeId, sessions, activate, requestCloseProject } = useApp();
  const open = openIds.map((id) => projects.find((p) => p.id === id)).filter((p) => !!p);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <strong>Portal IA</strong>
        <button className="btn primary" onClick={onNew}>+ Novo</button>
      </div>
      <button className="btn ghost quick" onClick={onQuick} title="Ctrl+P">Buscar projeto… <kbd>Ctrl+P</kbd></button>
      <div className="section-title">Projetos abertos</div>
      <ul className="proj-list">
        {open.length === 0 && <li className="empty">Nenhum projeto aberto. Use Ctrl+P.</li>}
        {open.map((p) => (
          <li key={p.id} className={p.id === activeId ? 'proj active' : 'proj'}>
            <button className="proj-btn" onClick={() => activate(p.id)}>
              <StatusDot status={aggregateStatus(sessions[p.id] ?? [])} />
              <span className="proj-name">{p.name}</span>
              <span className={`badge badge-${p.env === 'windows' ? 'win' : 'wsl'}`}>{p.env === 'windows' ? 'Win' : 'WSL'}</span>
            </button>
            <button className="close" aria-label={`Fechar ${p.name}`} onClick={() => requestCloseProject(p.id)}>×</button>
            {p.missing && <div className="missing">pasta não encontrada</div>}
          </li>
        ))}
      </ul>
      <div className="section-title">Agentes</div>
      <div className="disabled-area" aria-disabled="true">em breve</div>
    </aside>
  );
}
