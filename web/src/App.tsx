import { useEffect, useState } from 'react';
import { useApp } from './store';
import { connectEvents } from './events';
import { Sidebar } from './components/Sidebar';
import { QuickOpen } from './components/QuickOpen';
import { NewProjectDialog } from './components/NewProjectDialog';

export function App() {
  const { load, refreshProjects, applyEvent, openProject, projects, activeId, loaded } = useApp();
  const [quick, setQuick] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return connectEvents(applyEvent);
  }, [load, applyEvent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setQuick(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const active = projects.find((p) => p.id === activeId);

  return (
    <div className="app">
      <Sidebar onNew={() => setCreating(true)} onQuick={() => setQuick(true)} />
      <main className="main">
        {error && <div className="notice error">{error}</div>}
        {active ? (
          <div className="placeholder">Projeto {active.name}</div>
        ) : (
          <div className="placeholder muted">{loaded ? 'Abra um projeto com Ctrl+P ou crie um novo.' : 'Carregando…'}</div>
        )}
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
