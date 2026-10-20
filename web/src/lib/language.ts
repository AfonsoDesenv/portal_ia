const MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', md: 'markdown',
  css: 'css', html: 'html', py: 'python', cs: 'csharp', java: 'java', go: 'go', rs: 'rust',
  yml: 'yaml', yaml: 'yaml', sh: 'shell', sql: 'sql', xml: 'xml',
};

export function languageFor(path: string): string {
  const base = path.split('/').pop() ?? path;
  const i = base.lastIndexOf('.');
  if (i <= 0) return 'plaintext';
  return MAP[base.slice(i + 1).toLowerCase()] ?? 'plaintext';
}
