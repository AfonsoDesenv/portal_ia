export type BranchKind = 'feature' | 'hotfix' | 'outra';

/** Sugere a branch de origem e o prefixo do nome para um tipo de branch nova. */
export function suggestBranch(
  kind: BranchKind,
  current: string | null,
  branches: string[],
): { from: string; prefix: string } {
  const main = branches.includes('main') ? 'main' : branches.includes('master') ? 'master' : null;
  const fallback = current ?? main ?? branches[0] ?? '';
  if (kind === 'hotfix') return { from: main ?? fallback, prefix: 'hotfix/' };
  if (kind === 'feature') return { from: fallback, prefix: 'feature/' };
  return { from: fallback, prefix: '' };
}
