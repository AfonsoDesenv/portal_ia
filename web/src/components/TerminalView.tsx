import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const THEME = {
  background: '#1e1e1e', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8',
  magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
};

/**
 * Terminal ligado a /ws/term/:id. Permanece montado (escondido por CSS) para manter o WS aberto.
 * Para reconectar (retomada), o pai troca a `key` do componente.
 */
export function TerminalView({ sessionId }: { sessionId: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({ fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: 13, cursorBlink: true, theme: THEME, scrollback: 5000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    let ws: WebSocket | null = null;
    let stopped = false;
    let exited = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sendResize = () => {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    const refit = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return; // escondido
      try {
        fit.fit();
      } catch { /* sem layout ainda */ }
      sendResize();
    };

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/term/${encodeURIComponent(sessionId)}`);
      let first = true;
      ws.onopen = () => refit();
      ws.onmessage = (m) => {
        let msg: { type: string; data?: string };
        try {
          msg = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (msg.type === 'scrollback') {
          if (first) {
            first = false;
            term.reset(); // reconexão: o scrollback reenviado substitui o conteúdo
          }
          term.write(msg.data ?? '');
        } else if (msg.type === 'data') {
          term.write(msg.data ?? '');
        } else if (msg.type === 'exit') {
          exited = true;
          term.write('\r\n\x1b[90m[processo encerrado]\x1b[0m\r\n');
        }
      };
      ws.onclose = (ev) => {
        if (stopped || exited || ev.code === 4404) return;
        timer = setTimeout(connect, 2000);
      };
    };
    connect();

    const sub = term.onData((data) => {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'input', data }));
    });
    const ro = new ResizeObserver(refit);
    ro.observe(el);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ro.disconnect();
      sub.dispose();
      ws?.close();
      term.dispose();
    };
  }, [sessionId]);

  return <div className="term-host" ref={host} />;
}
