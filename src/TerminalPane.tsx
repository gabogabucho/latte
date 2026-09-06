import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { agentBus, api } from './browser-api';

export function TerminalPane({ sessionId, onError }: { sessionId: string; onError: (error: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const errorRef = useRef(onError); errorRef.current = onError;
  useEffect(() => {
    const terminal = new Terminal({ fontFamily: 'Consolas, monospace', fontSize: 12, cursorBlink: true, theme: { background: '#27251f', foreground: '#f4efe7', cursor: '#c66a46', selectionBackground: '#6f5745' }, convertEol: true, scrollback: 3000 });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(root.current!);
    terminal.writeln('\x1b[90mSesión CLI real · permisos gestionados por el agente\x1b[0m');
    // The bus replays anything the CLI printed before this pane existed.
    const off = agentBus.subscribe(sessionId, event => { if (event.type === 'output') terminal.write(event.data); else terminal.writeln('\r\n' + event.data); });
    const input = terminal.onData(data => { void api.writeAgent(sessionId, data).catch(e => errorRef.current(String(e))); });
    const resize = () => { if (!root.current?.clientWidth) return; fit.fit(); void api.resizeAgent(sessionId, terminal.cols, terminal.rows).catch(() => {}); };
    const observer = new ResizeObserver(resize); observer.observe(root.current!); resize();
    return () => { off(); input.dispose(); observer.disconnect(); terminal.dispose(); };
  }, [sessionId]);
  return <div className="terminal-host" ref={root} aria-label="Terminal del agente" />;
}
