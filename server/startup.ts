import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Primeira pasta que é um front COMPILADO (index.html + assets/). A fonte do Vite (web/) não serve. */
export function pickWebDir(candidates: string[]): string | undefined {
  return candidates.find((d) => {
    try {
      return existsSync(join(d, 'index.html')) && statSync(join(d, 'assets')).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Mensagem para falha no listen. */
export function listenError(e: unknown, port: number): string {
  if ((e as NodeJS.ErrnoException)?.code === 'EADDRINUSE') return `Portal IA já está rodando em http://localhost:${port}`;
  return `Não foi possível iniciar o Portal IA: ${e instanceof Error ? e.message : String(e)}`;
}

/** Encerra os processos de terminal e fecha o servidor. */
export async function shutdown(pty: { killAll(): void }, app: { close(): Promise<unknown> }): Promise<void> {
  try {
    pty.killAll();
  } finally {
    await app.close();
  }
}
