import { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type { ChangedFile } from '@shared';
import { api, type FileVersions } from '../api';
import { useApp } from '../store';
import { languageFor } from '../lib/language';
import '../lib/monaco';
import { ChangesPanel } from './ChangesPanel';

/**
 * Modo Review. O terminal do Claude NÃO é montado aqui: o ProjectView mantém o host DOM da sessão
 * e `attachClaude` o move para dentro da barra "Claude" (mesmo TerminalView, mesmo WS).
 */
export function ReviewView({ projectId, attachClaude }: { projectId: string; attachClaude: (el: HTMLDivElement | null) => void }) {
  const tick = useApp((s) => s.gitTick[projectId] ?? 0);
  const [active, setActive] = useState<string | null>(null);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [version, setVersion] = useState<FileVersions | null>(null);
  const [error, setError] = useState('');
  const [sideBySide, setSideBySide] = useState(true);
  const [claudeOpen, setClaudeOpen] = useState(false);

  // Mantém um arquivo aberto: o primeiro, ou o que sobrou se o atual sumiu.
  useEffect(() => {
    if (files.length === 0) setActive(null);
    else if (!active || !files.some((f) => f.path === active)) setActive(files[0].path);
  }, [files, active]);

  useEffect(() => {
    if (!active) { setVersion(null); return; }
    let stale = false;
    api.gitFile(projectId, active)
      .then((v) => { if (!stale) { setVersion(v); setError(''); } })
      .catch((e) => { if (!stale) { setVersion(null); setError(e instanceof Error ? e.message : String(e)); } });
    return () => { stale = true; };
  }, [projectId, active, tick]);

  return (
    <div className="review">
      <div className="review-main">
        <aside className="review-files">
          <ChangesPanel projectId={projectId} compact activePath={active}
            onOpenFile={(f) => setActive(f.path)} onFiles={setFiles} />
        </aside>
        <div className="review-diff">
          <div className="review-toolbar">
            <span className="review-path">{active ?? 'Nenhum arquivo selecionado'}</span>
            <button className="btn" onClick={() => setSideBySide((v) => !v)}>
              {sideBySide ? 'junto' : 'lado a lado'}
            </button>
          </div>
          <div className="review-editor">
            {error && <div className="notice error">{error}</div>}
            {!error && version?.binary && <div className="placeholder muted">arquivo binário</div>}
            {!error && version && !version.binary && active && (
              <DiffEditor key={active} height="100%" theme="vs-dark" language={languageFor(active)}
                original={version.original} modified={version.modified}
                options={{ readOnly: true, originalEditable: false, renderSideBySide: sideBySide, automaticLayout: true, minimap: { enabled: false } }} />
            )}
            {!error && !active && <div className="placeholder muted">Sem alterações para revisar.</div>}
          </div>
        </div>
      </div>
      <div className={claudeOpen ? 'claude-bar open' : 'claude-bar'}>
        <button className="claude-bar-head" onClick={() => setClaudeOpen((v) => !v)} aria-expanded={claudeOpen}>
          {claudeOpen ? '▾' : '▸'} Claude
        </button>
        <div className="claude-slot" style={{ display: claudeOpen ? 'flex' : 'none' }} ref={attachClaude} />
      </div>
    </div>
  );
}
