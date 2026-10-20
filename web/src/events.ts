import type { ServerEvent } from '@shared';

/** Conecta em /ws/events com reconexão simples. Devolve função para encerrar. */
export function connectEvents(onEvent: (e: ServerEvent) => void, onOpen?: () => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws/events`);
    ws.onopen = () => onOpen?.();
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as ServerEvent);
      } catch { /* ignora mensagem inválida */ }
    };
    ws.onclose = () => {
      if (!stopped) timer = setTimeout(connect, 2000);
    };
  };
  connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
