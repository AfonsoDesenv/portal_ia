/** Atalhos globais do portal: precisam funcionar mesmo com o foco dentro de um terminal. */
export function isPortalShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>): boolean {
  if (!e.ctrlKey || e.altKey || e.metaKey) return false;
  const k = e.key.toLowerCase();
  if (k === 'p') return !e.shiftKey; // Ctrl+P: busca de projeto
  if (k === 'r') return e.shiftKey; // Ctrl+Shift+R: Trabalho/Review
  return false;
}
