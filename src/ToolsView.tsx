import { useEffect, useState } from 'react';
import { AlertTriangle, Check, LoaderCircle, Plug, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { McpRuntimeTools, McpServer } from '../shared/contracts';
import { api } from './browser-api';

const RUNTIME_NAME: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
const STATUS_LABEL: Record<McpServer['status'], string> = {
  connected: 'Conectado',
  failed: 'No conecta',
  pending: 'Pendiente de aprobar',
  disabled: 'Desactivado',
  configured: 'Configurado',
};
const displayError = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * MCP: the tools an agent can reach beyond this folder.
 *
 * Latte implements no MCP client and stores no credential. It reads and writes
 * each runtime's own configuration through its `mcp` command, so what you see
 * here is what that runtime will actually use, in Latte and outside it.
 */
export function ToolsView({ onNotice, onError }: { onNotice: (text: string) => void; onError: (text: string) => void }) {
  const [runtimes, setRuntimes] = useState<McpRuntimeTools[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<'claude' | 'codex' | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRuntimes(await api.listMcpServers());
    } catch (e) {
      onError(displayError(e));
      setRuntimes(r => r ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const remove = (runtime: 'claude' | 'codex', name: string) => {
    if (!window.confirm(`¿Quitar «${name}» de ${RUNTIME_NAME[runtime]}? Se quita de ese runtime, no solo de Latte.`)) return;
    setBusy(true);
    api.removeMcpServer(runtime, name)
      .then(async () => { await load(); onNotice(`«${name}» quitado de ${RUNTIME_NAME[runtime]}`); })
      .catch(e => onError(displayError(e)))
      .finally(() => setBusy(false));
  };

  return <section className="settings-section tools-view">
    <h2>Herramientas de los agentes (MCP)</h2>
    <p className="settings-lead">
      Sin esto, un agente solo ve los archivos de este trabajo. Con MCP puede además consultar y operar
      herramientas externas. Latte no implementa MCP ni guarda credenciales: lee y escribe la configuración
      de cada runtime, así que lo que agregues acá también va a estar cuando uses ese CLI por fuera.
    </p>
    <button className="subtle" disabled={loading || busy} onClick={() => void load()}>{loading ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}Actualizar</button>

    {loading && !runtimes && <p className="footnote"><LoaderCircle className="spin" size={13} /> Consultando cada runtime… El de Claude Code además prueba la conexión, puede tardar unos segundos.</p>}

    {runtimes?.map(rt => <div className="runtime-card" key={rt.runtime}>
      <div className="runtime-head">
        <strong>{RUNTIME_NAME[rt.runtime] ?? rt.runtime}</strong>
        <small>{rt.detail}</small>
      </div>
      {rt.installed && rt.servers.length === 0 && <p className="footnote">Sin herramientas configuradas todavía.</p>}
      {rt.servers.length > 0 && <div className="provider-list">
        {rt.servers.map(server => <div className="provider-card mcp-card" key={server.name}>
          <i className={'mcp-dot ' + server.status} title={STATUS_LABEL[server.status]} />
          <div>
            <strong>{server.name}</strong>
            <small title={server.target}>{server.transport === 'http' ? 'HTTP' : 'proceso local'} · {server.target || 'sin destino declarado'}</small>
            {server.detail && server.status !== 'connected' && <small className="mcp-detail">{server.detail}</small>}
          </div>
          <span className="tag">{STATUS_LABEL[server.status]}</span>
          {rt.canEdit && <button className="icon-button" aria-label={`Quitar ${server.name}`} title="Quitar de este runtime" disabled={busy} onClick={() => remove(rt.runtime as 'claude' | 'codex', server.name)}><Trash2 size={14} /></button>}
        </div>)}
      </div>}
      {rt.installed && rt.canEdit && adding !== rt.runtime && <button className="subtle" disabled={busy} onClick={() => setAdding(rt.runtime as 'claude' | 'codex')}><Plus size={13} />Conectar una herramienta</button>}
      {adding === rt.runtime && <AddServer runtime={rt.runtime as 'claude' | 'codex'} busy={busy} onCancel={() => setAdding(null)} onAdd={async input => {
        setBusy(true);
        try {
          await api.addMcpServer(rt.runtime as 'claude' | 'codex', input);
          setAdding(null);
          await load();
          onNotice(`«${input.name}» quedó configurado en ${RUNTIME_NAME[rt.runtime]}`);
        } catch (e) { onError(displayError(e)); } finally { setBusy(false); }
      }} />}
      {rt.installed && !rt.canEdit && <p className="footnote"><AlertTriangle size={13} /> Para agregar acá, usá <code>opencode mcp add</code> en una terminal: ese comando pregunta paso a paso y no se puede automatizar sin inventar respuestas.</p>}
    </div>)}

    <p className="footnote">
      Una herramienta MCP puede leer y escribir fuera de esta carpeta, según lo que ese servidor permita.
      Los permisos los aplica el runtime, no Latte, y sus pedidos aparecen en la conversación para que decidas.
    </p>
  </section>;
}

function AddServer({ runtime, busy, onCancel, onAdd }: {
  runtime: 'claude' | 'codex';
  busy: boolean;
  onCancel: () => void;
  onAdd: (input: { name: string; transport: 'stdio' | 'http'; command: string; args: string[]; url: string; env: string[] }) => Promise<void>;
}) {
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [envText, setEnvText] = useState('');
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const env = envText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const ready = name.trim().length > 0 && (transport === 'http' ? /^https?:\/\//.test(url.trim()) : parts.length > 0);

  return <div className="chat-card mcp-form" role="group" aria-label="Conectar una herramienta">
    <div className="chat-card-title"><Plug size={15} />Conectar en {RUNTIME_NAME[runtime]}</div>
    <label className="field-label" htmlFor={`mcp-name-${runtime}`}>NOMBRE</label>
    <input id={`mcp-name-${runtime}`} value={name} maxLength={64} placeholder="Ej. notion" onChange={e => setName(e.target.value)} />
    <label className="field-label" htmlFor={`mcp-transport-${runtime}`}>CÓMO SE CONECTA</label>
    <select id={`mcp-transport-${runtime}`} value={transport} onChange={e => setTransport(e.target.value as 'stdio' | 'http')}>
      <option value="stdio">Un programa en esta máquina</option>
      <option value="http">Un servidor por HTTP</option>
    </select>
    {transport === 'stdio' ? <>
      <label className="field-label" htmlFor={`mcp-command-${runtime}`}>COMANDO</label>
      <input id={`mcp-command-${runtime}`} value={command} maxLength={400} placeholder="npx -y @modelcontextprotocol/server-filesystem" onChange={e => setCommand(e.target.value)} />
      <label className="field-label" htmlFor={`mcp-env-${runtime}`}>VARIABLES (UNA POR LÍNEA, OPCIONAL)</label>
      <textarea id={`mcp-env-${runtime}`} className="context-editor short" value={envText} placeholder={'API_KEY=...'} onChange={e => setEnvText(e.target.value)} />
      <p className="footnote">Las variables se las pasa Latte al CLI del runtime y quedan en su configuración. Latte no las guarda ni las muestra después.</p>
    </> : <>
      <label className="field-label" htmlFor={`mcp-url-${runtime}`}>URL</label>
      <input id={`mcp-url-${runtime}`} value={url} maxLength={500} placeholder="https://mcp.ejemplo.com/mcp" onChange={e => setUrl(e.target.value)} />
      <p className="footnote">Si el servidor pide autenticación, iniciá sesión con <code>{runtime} mcp login {name || 'nombre'}</code> después de agregarlo.</p>
    </>}
    <div className="chat-card-actions">
      <button className="primary" disabled={busy || !ready} onClick={() => void onAdd({ name: name.trim(), transport, command: parts[0] ?? '', args: parts.slice(1), url: url.trim(), env })}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Conectar</button>
      <button disabled={busy} onClick={onCancel}><X size={14} />Cancelar</button>
    </div>
  </div>;
}
