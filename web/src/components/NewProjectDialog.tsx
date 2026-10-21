import { useEffect, useState } from 'react';
import type { EnvId, Project } from '@shared';
import { api, type EnvironmentsInfo, type GhStatus } from '../api';

interface Props {
  onClose: () => void;
  onCreated: (project: Project) => void;
}

const envLabel = (e: EnvId) => (e === 'windows' ? 'Windows' : `WSL (${e.slice(4)})`);

export function NewProjectDialog({ onClose, onCreated }: Props) {
  const [info, setInfo] = useState<EnvironmentsInfo | null>(null);
  const [env, setEnv] = useState<EnvId>('windows');
  const [mode, setMode] = useState<'nova' | 'existente'>('nova');
  const [name, setName] = useState('');
  const [baseDir, setBaseDir] = useState('');
  const [path, setPath] = useState('');
  const [gh, setGh] = useState<GhStatus | null>(null);
  const [useGh, setUseGh] = useState(false);
  const [owner, setOwner] = useState('');
  const [priv, setPriv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ project: Project; warnings: string[] } | null>(null);
  const [ignoreDone, setIgnoreDone] = useState(false);

  useEffect(() => {
    let alive = true;
    api.environments().then((i) => alive && setInfo(i)).catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (info) setBaseDir(env === 'windows' ? info.roots.windows : info.roots.wsl);
  }, [info, env]);

  useEffect(() => {
    let alive = true;
    setGh(null);
    setUseGh(false);
    api.ghStatus(env)
      .then((s) => {
        if (!alive) return;
        setGh(s);
        setUseGh(s.installed && s.loggedIn); // marcada por padrão quando possível
        setOwner(s.user ?? '');
      })
      .catch(() => alive && setGh({ installed: false, loggedIn: false, user: null, orgs: [] }));
    return () => { alive = false; };
  }, [env]);

  const ghReady = !!gh && gh.installed && gh.loggedIn;
  const ghHint = info?.hints.gh[env === 'windows' ? 'windows' : 'wsl'];
  const where = env === 'windows' ? 'no PowerShell' : 'no terminal do WSL';
  const owners = gh ? [gh.user, ...gh.orgs].filter((x): x is string => !!x) : [];

  const canSubmit = !busy && (mode === 'nova' ? name.trim() && baseDir.trim() : path.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    const github = useGh && ghReady ? { ...(owner ? { owner } : {}), private: priv } : false;
    try {
      const r = mode === 'nova'
        ? await api.createProject({ env, name: name.trim(), baseDir: baseDir.trim(), github })
        : await api.registerProject({ env, path: path.trim(), github });
      if (r.warnings.length === 0) onCreated(r.project);
      else setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function makeIgnore() {
    if (!result) return;
    try {
      await api.createGitignore(result.project.id);
      setIgnoreDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (result) {
    const ghFail = result.warnings.find((w) => w.startsWith('github-falhou'));
    const noIgnore = result.warnings.includes('sem-gitignore');
    const commitFail = result.warnings.find((w) => w.startsWith('commit-inicial-falhou'));
    return (
      <div className="overlay">
        <div className="modal dialog" role="dialog" aria-label="Projeto criado">
          <h2>Projeto adicionado</h2>
          <p>{result.project.name} foi adicionado ao portal.</p>
          {commitFail && <p className="notice warn">O commit inicial falhou ({commitFail.replace(/^commit-inicial-falhou:\s*/, '')}). A pasta, o README e o .gitignore foram criados; faça o primeiro commit pelo painel de alterações.</p>}
          {ghFail && <p className="notice warn">Não foi possível criar o repositório no GitHub ({ghFail.replace(/^github-falhou:\s*/, '')}). O projeto local foi criado normalmente.</p>}
          {noIgnore && !ignoreDone && (
            <p className="notice">
              A pasta não tem .gitignore. <button type="button" className="btn" onClick={makeIgnore}>Criar .gitignore</button>
            </p>
          )}
          {ignoreDone && <p className="notice">.gitignore criado.</p>}
          {error && <p className="notice error">{error}</p>}
          <div className="actions"><button className="btn primary" onClick={() => onCreated(result.project)}>Concluir</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onMouseDown={() => { if (!busy) onClose(); }}>
      <form className="modal dialog" role="dialog" aria-label="Novo projeto" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <h2>Novo projeto</h2>

        <label className="field">Ambiente
          <select value={env} onChange={(e) => setEnv(e.target.value as EnvId)}>
            {(info?.envs ?? [{ env: 'windows' as EnvId }]).map((t) => (
              <option key={t.env} value={t.env}>{envLabel(t.env)}</option>
            ))}
          </select>
        </label>

        <div className="seg">
          <label><input type="radio" name="mode" checked={mode === 'nova'} onChange={() => setMode('nova')} /> Pasta nova</label>
          <label><input type="radio" name="mode" checked={mode === 'existente'} onChange={() => setMode('existente')} /> Pasta existente</label>
        </div>

        {mode === 'nova' ? (
          <>
            <label className="field">Nome
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label className="field">Pasta base
              <input value={baseDir} onChange={(e) => setBaseDir(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="field">Caminho da pasta
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={env === 'windows' ? 'C:\\GIT\\meu-projeto' : '~/git/meu-projeto'} autoFocus />
          </label>
        )}

        <label className="check">
          <input type="checkbox" checked={useGh} disabled={!ghReady} onChange={(e) => setUseGh(e.target.checked)} />
          Criar repositório no GitHub
        </label>

        {gh && !gh.installed && (
          <p className="notice warn">
            GitHub CLI não encontrado. Instale ({where}): <code>{ghHint}</code> e depois rode <code>gh auth login</code> (depois feche e abra este diálogo de novo).
          </p>
        )}
        {gh && gh.installed && !gh.loggedIn && (
          <p className="notice warn">GitHub CLI sem login. Rode <code>gh auth login</code> ({where}).</p>
        )}

        {useGh && ghReady && (
          <div className="gh-opts">
            <label className="field">Dono
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <div className="seg">
              <label><input type="radio" name="vis" checked={priv} onChange={() => setPriv(true)} /> Privado</label>
              <label><input type="radio" name="vis" checked={!priv} onChange={() => setPriv(false)} /> Público</label>
            </div>
          </div>
        )}

        {error && <p className="notice error">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={!canSubmit}>{busy ? 'Criando…' : mode === 'nova' ? 'Criar' : 'Adicionar'}</button>
        </div>
      </form>
    </div>
  );
}
