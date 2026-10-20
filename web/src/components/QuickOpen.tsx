import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyFilter } from '../lib/fuzzy';
import { useApp } from '../store';

export function QuickOpen({ onClose }: { onClose: () => void }) {
  const projects = useApp((s) => s.projects);
  const openProject = useApp((s) => s.openProject);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => fuzzyFilter(projects, q), [projects, q]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setSel(0), [q]);

  const choose = (i: number) => {
    const p = results[i];
    if (!p) return;
    void openProject(p.id);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') onClose();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal quickopen" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Abrir projeto…" aria-label="Buscar projeto" />
        <ul>
          {results.length === 0 && <li className="empty">Nenhum projeto encontrado</li>}
          {results.map((p, i) => (
            <li key={p.id} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
              <span>{p.name}</span>
              <span className="path">{p.path}</span>
              <span className={`badge badge-${p.env === 'windows' ? 'win' : 'wsl'}`}>{p.env === 'windows' ? 'Win' : 'WSL'}</span>
              {p.missing && <span className="missing">pasta não encontrada</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
