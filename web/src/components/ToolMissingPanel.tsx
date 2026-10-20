import { useState } from 'react';
import type { EnvId } from '@shared';

export interface ToolMissing { ferramenta: string; dica: string; env: EnvId }

export function ToolMissingPanel({ info, onDismiss }: { info: ToolMissing; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  const where = info.env === 'windows' ? 'no PowerShell' : 'no terminal do WSL';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.dica);
      setCopied(true);
    } catch { /* sem permissão de área de transferência */ }
  };
  return (
    <div className="tool-missing">
      <h3>`{info.ferramenta}` não está instalado neste ambiente</h3>
      <p>Rode {where} (reinicie o portal depois):</p>
      <code>{info.dica}</code>
      <div className="actions">
        <button className="btn primary" onClick={copy}>{copied ? 'Copiado' : 'copiar comando'}</button>
        <button className="btn" onClick={onDismiss}>Fechar</button>
      </div>
    </div>
  );
}
