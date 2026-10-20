import { useEffect, useState } from 'react';
import type { ProjectView } from '@shared';
import { api } from '../api';
import { useApp, type Mode } from '../store';
import { NewBranchDialog } from './NewBranchDialog';

export function TopBar({ project, mode, onError }: { project: ProjectView; mode: Mode; onError: (m: string) => void }) {
  const setMode = useApp((s) => s.setMode);
  const tick = useApp((s) => s.gitTick[project.id] ?? 0);
  const [info, setInfo] = useState<{ current: string | null; local: string[] } | null>(null);
  const [newBranch, setNewBranch] = useState(false);

  useEffect(() => {
    if (project.missing) return;
    api.branches(project.id).then(setInfo).catch(() => setInfo(null));
  }, [project.id, project.missing, tick]);

  return (
    <header className="topbar">
      <strong className="topbar-name">{project.name}</strong>
      <select className="branch-select" value={info?.current ?? ''} disabled title="Para trocar de branch, use um terminal"
        aria-label="Branch atual">
        {info === null && <option value="">—</option>}
        {info && info.current === null && <option value="">(sem branch)</option>}
        {info?.local.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <button className="btn" disabled={project.missing || !info} onClick={() => setNewBranch(true)}>+ Nova branch</button>
      <div className="mode-toggle" role="group" aria-label="Modo">
        <button className={mode === 'trabalho' ? 'btn primary' : 'btn'} onClick={() => setMode(project.id, 'trabalho')}>Trabalho</button>
        <button className={mode === 'review' ? 'btn primary' : 'btn'} onClick={() => setMode(project.id, 'review')}>Review</button>
      </div>
      <button className="btn" disabled={project.missing}
        onClick={() => api.openVsCode(project.id).catch((e) => onError(e instanceof Error ? e.message : String(e)))}>
        Abrir no VS Code
      </button>
      {newBranch && <NewBranchDialog projectId={project.id} onClose={() => setNewBranch(false)} />}
    </header>
  );
}
