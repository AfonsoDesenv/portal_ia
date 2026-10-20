import type { ProjectView } from '@shared';

/** Pontuação de subsequência: null se não casa; menor é melhor. */
function score(name: string, q: string): number | null {
  const n = name.toLowerCase();
  let pos = -1;
  let total = 0;
  for (const ch of q.toLowerCase()) {
    const next = n.indexOf(ch, pos + 1);
    if (next < 0) return null;
    total += pos < 0 ? next : next - pos - 1; // letras puladas
    pos = next;
  }
  return total;
}

export function fuzzyFilter(items: ProjectView[], q: string): ProjectView[] {
  const query = q.trim();
  if (!query) return items;
  return items
    .map((p) => ({ p, s: score(p.name, query) }))
    .filter((x): x is { p: ProjectView; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.p);
}
