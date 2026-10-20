import { useEffect, useState } from 'react';
import { api } from '../api';
import { suggestBranch, type BranchKind } from '../lib/branch';

export function NewBranchDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [kind, setKind] = useState<BranchKind>('feature');
  const [current, setCurrent] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.branches(projectId).then((b) => {
      setCurrent(b.current);
      setBranches(b.local);
      setFrom(suggestBranch('feature', b.current, b.local).from);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId]);

  const sug = suggestBranch(kind, current, branches);
  const pick = (k: BranchKind) => {
    setKind(k);
    setFrom(suggestBranch(k, current, branches).from);
  };
  const full = `${sug.prefix}${name.trim()}`;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.createBranch(projectId, full, from);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal dialog" role="dialog" aria-label="Nova branch" onClick={(e) => e.stopPropagation()}>
        <h2>Nova branch</h2>
        <div className="seg">
          {(['feature', 'hotfix', 'outra'] as const).map((k) => (
            <label key={k} className="check">
              <input type="radio" name="kind" checked={kind === k} onChange={() => pick(k)} /> {k === 'outra' ? 'Outra' : k === 'feature' ? 'Feature' : 'Hotfix'}
            </label>
          ))}
        </div>
        <label className="field">A partir de
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="field">Nome
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: login" />
        </label>
        {name.trim() && <div className="muted">Será criada: <code>{full}</code></div>}
        {error && <div className="notice error">{error}</div>}
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !name.trim() || !from} onClick={submit}>Criar</button>
        </div>
      </div>
    </div>
  );
}
