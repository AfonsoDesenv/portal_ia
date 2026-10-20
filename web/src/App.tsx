import { useEffect, useState } from 'react';
import { useApp } from './store';
import { connectEvents } from './events';
import { isPortalShortcut } from './lib/shortcuts';
import { Sidebar } from './components/Sidebar';
import { QuickOpen } from './components/QuickOpen';
import { ProjectView } from './components/ProjectView';
import { NewProjectDialog } from './components/NewProjectDialog';

export function App() {
  const { load, refreshProjects, applyEvent, openProject, projects, openIds, activeId, loaded } = useApp();
  const [quick, setQuick] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    const reload = () => load().catch(() => undefined);
    return connectEvents(applyEvent, reload);
  }, [load, applyEvent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isPortalShortcut(e) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setQuick(true);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  const active = projects.find((p) => p.id === activeId);

  return (
    <div className="app">
      <Sidebar onNew={() => setCreating(true)} onQuick={() => setQuick(true)} />
      <main className="main">
        {error && <div className="notice error">{error}</div>}
        {openIds.map((id) => {
          const p = projects.find((x) => x.id === id);
          return p ? <ProjectView key={id} project={p} visible={id === activeId} /> : null;
        })}
        {!active && <div className="placeholder muted">{loaded ? 'Abra um projeto com Ctrl+P ou crie um novo.' : 'Carregando…'}</div>}
      </main>
      {quick && <QuickOpen onClose={() => setQuick(false)} />}
      {creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={async (p) => {
            setCreating(false);
            await refreshProjects();
            await openProject(p.id);
          }}
        />
      )}
    </div>
  );
}
