import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangedFile } from '@shared';
import { ApiError, api } from '../api';
import { useApp } from '../store';

const POLL_MS = 3000;

/** `.env`, `.env.local`, `config/.env.prod`: começam desmarcados. */
export function isEnvFile(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  return base.startsWith('.env');
}

const EMPTY: Record<string, boolean> = {};

export interface ChangesPanelProps {
  projectId: string;
  compact: boolean;
  /** Review: arquivo cujo diff está aberto e callback ao clicar no nome. */
  activePath?: string | null;
  onOpenFile?: (file: ChangedFile) => void;
  /** Informa a lista atual (o Review usa para limpar o diff de arquivos que sumiram). */
  onFiles?: (files: ChangedFile[]) => void;
}

export function ChangesPanel({ projectId, compact, activePath, onOpenFile, onFiles }: ChangesPanelProps) {
  const tick = useApp((s) => s.gitTick[projectId] ?? 0);
  const isActive = useApp((s) => s.activeId === projectId);
  const stored = useApp((s) => s.selection[projectId]) ?? EMPTY;
  const setSelection = useApp((s) => s.setSelection);
  const setMode = useApp((s) => s.setMode);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [branch, setBranch] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const message = useApp((s) => s.draft[projectId]) ?? '';
  const setDraft = useApp((s) => s.setDraft);
  const setMessage = (t: string) => setDraft(projectId, t);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  // Sequência das leituras: uma resposta mais velha que a última aplicada é descartada.
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  const inFlightRef = useRef(0);

  /** `poll`: tick do polling, pulado se já houver leitura em andamento. */
  const refresh = useCallback(async (poll = false) => {
    if (poll && inFlightRef.current > 0) return;
    const seq = ++seqRef.current;
    inFlightRef.current++;
    try {
      const st = await api.gitStatus(projectId);
      if (seq < appliedRef.current) return;
      appliedRef.current = seq;
      setFiles(st.files);
      setBranch(st.branch);
      setLoadError('');
      onFilesRef.current?.(st.files);
      // Mantém só escolhas de caminhos que ainda existem; novos caminhos usam o padrão.
      const current = useApp.getState().selection[projectId] ?? {};
      const kept = Object.fromEntries(st.files.filter((f) => f.path in current).map((f) => [f.path, current[f.path]]));
      if (Object.keys(kept).length !== Object.keys(current).length) setSelection(projectId, kept);
    } catch (e) {
      if (seq >= appliedRef.current) setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current--;
    }
  }, [projectId, setSelection]);

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Atualiza ao montar e a cada git-changed.
  useEffect(() => {
    void refresh();
  }, [refresh, tick]);

  // Polling só com a aba visível e o projeto ativo.
  useEffect(() => {
    if (!visible || !isActive) return;
    void refresh(true);
    const t = setInterval(() => void refresh(true), POLL_MS);
    return () => clearInterval(t);
  }, [visible, isActive, refresh]);

  const checked = (f: ChangedFile) => stored[f.path] ?? !isEnvFile(f.path);
  const selected = files.filter(checked);
  // Renomeação: sem o caminho antigo no commit, a remoção dele ficaria de fora.
  const commitPaths = [...new Set(selected.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])))];
  const canCommit = !busy && message.trim() !== '' && selected.length > 0;

  const toggle = (f: ChangedFile) => setSelection(projectId, { ...stored, [f.path]: !checked(f) });

  const doCommit = async (push: boolean) => {
    setBusy(true);
    setFeedback(null);
    try {
      const r = await api.commit(projectId, { files: commitPaths, message: message.trim(), push });
      const hash7 = r.hash.slice(0, 7);
      if (push && r.erroPush) setFeedback({ kind: 'warn', text: `Commit feito. Push falhou: ${r.erroPush}` });
      else if (push) setFeedback({ kind: 'ok', text: 'Commit feito e enviado' });
      else setFeedback({ kind: 'ok', text: `Commit feito (${hash7})` });
      setMessage('');
      setSelection(projectId, {});
      await refresh();
    } catch (e) {
      const text = e instanceof ApiError && e.status === 409 ? String(e.body.mensagem ?? e.message) : e instanceof Error ? e.message : String(e);
      setFeedback({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? 'changes compact' : 'changes'}>
      <h3>Alterações{branch ? ` · ${branch}` : ''}</h3>
      {loadError && <div className="notice error">{loadError}</div>}
      {files.length === 0 && !loadError && <p className="muted">Nenhuma alteração.</p>}
      <ul className="change-list">
        {files.map((f) => (
          <li key={f.path} className={f.path === activePath ? 'change active' : 'change'}>
            <input type="checkbox" aria-label={f.path} checked={checked(f)} onChange={() => toggle(f)} />
            {onOpenFile ? (
              <button className="change-name link" title={f.path} onClick={() => onOpenFile(f)}>{f.path}</button>
            ) : (
              <span className="change-name" title={f.path}>{f.path}</span>
            )}
            {f.oldPath && <span className="muted change-old">← {f.oldPath}</span>}
            {f.binary ? <span className="muted">bin</span> : f.index === '?' && f.worktree === '?' && f.added === 0 ? (
              <span className="muted">novo</span>
            ) : (
              <span className="change-counts"><span className="add">+{f.added}</span> <span className="del">−{f.removed}</span></span>
            )}
          </li>
        ))}
      </ul>
      <textarea className="commit-msg" placeholder="Mensagem do commit" rows={3} value={message}
        onChange={(e) => setMessage(e.target.value)} />
      <div className="commit-actions">
        <button className="btn" disabled={!canCommit} onClick={() => doCommit(false)}>Commit</button>
        <button className="btn primary" disabled={!canCommit} onClick={() => doCommit(true)}>Commit + Push</button>
      </div>
      {feedback && <div className={`notice ${feedback.kind === 'ok' ? '' : feedback.kind}`}>{feedback.text}</div>}
      {!compact && (
        <button className="btn review-link" onClick={() => setMode(projectId, 'review')}>Revisar →</button>
      )}
    </div>
  );
}
