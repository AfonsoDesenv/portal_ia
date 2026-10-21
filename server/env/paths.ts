export function toWslPath(winPath: string): string {
  const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(winPath);
  if (!m) return winPath.replace(/\\/g, '/');
  const rest = m[2].replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}${rest ? '/' + rest : ''}`;
}

export function joinEnvPath(env: string, ...parts: string[]): string {
  const sep = env === 'windows' ? '\\' : '/';
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(sep);
}
