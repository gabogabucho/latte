import { translate as t } from './i18n';
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, LoaderCircle, Plug, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { ChatRuntime, McpRuntimeTools, McpServer } from '../shared/contracts';
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

  /**
   * One query per runtime, all three at once, each card drawn as it answers.
   * Claude Code health-checks every server it has configured, so it can take
   * half a minute; Codex and OpenCode answer in a second and there is no
   * reason to hide them behind the slow one.
   */
  const load = async () => {
    setLoading(true);
    setRuntimes(null);
    const order: ChatRuntime[] = ['claude', 'codex', 'opencode'];
    const done = new Map<ChatRuntime, McpRuntimeTools>();
    await Promise.all(order.map(async runtime => {
      try {
        const [result] = await api.listMcpServers(runtime);
        if (result) done.set(runtime, result);
      } catch (e) {
        onError(displayError(e));
      }
      setRuntimes(order.filter(r => done.has(r)).map(r => done.get(r) as McpRuntimeTools));
    }));
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const remove = (runtime: 'claude' | 'codex', name: string) => {
    if (!window.confirm(t('ui.auto.407', { p0: name, p1: RUNTIME_NAME[runtime] }))) return;
    setBusy(true);
    api.removeMcpServer(runtime, name)
      .then(async () => { await load(); onNotice(`«${name}» quitado de ${RUNTIME_NAME[runtime]}`); })
      .catch(e => onError(displayError(e)))
      .finally(() => setBusy(false));
  };

  return <section className="settings-section tools-view">
    <h2>{t('ui.auto.304')}</h2>
    <p className="settings-lead">

      {t('ui.auto.305')}
    </p>
    <button className="subtle" disabled={loading || busy} onClick={() => void load()}>{loading ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}{t('ui.auto.306')}</button>

    {/* A blank wait reads as "no hay nada": name what is still pending. */}
    {loading && Object.entries(RUNTIME_NAME).filter(([key]) => !runtimes?.some(r => r.runtime === key)).map(([key, label]) => <div className="runtime-card pending" key={key}>
      <div className="runtime-head"><strong>{label}</strong><small><LoaderCircle className="spin" size={12} />  {t('ui.auto.408')}</small></div>
    </div>)}
    {loading && <p className="footnote">{t('ui.auto.307')}</p>}

    {runtimes?.map(rt => <div className="runtime-card" key={rt.runtime}>
      <div className="runtime-head">
        <strong>{RUNTIME_NAME[rt.runtime] ?? rt.runtime}</strong>
        <small>{rt.detail}</small>
      </div>
      {rt.installed && rt.servers.length === 0 && <p className="footnote">{t('ui.auto.308')}</p>}
      {rt.servers.length > 0 && <div className="provider-list">
        {rt.servers.map(server => <div className="provider-card mcp-card" key={server.name}>
          <i className={'mcp-dot ' + server.status} title={STATUS_LABEL[server.status]} />
          <div>
            <strong>{server.name}</strong>
            <small title={server.target}>{server.transport === 'http' ? 'HTTP' : t('ui.auto.309')} · {server.target || t('ui.auto.310')}</small>
            {server.detail && server.status !== 'connected' && <small className="mcp-detail">{server.detail}</small>}
          </div>
          <span className="tag">{STATUS_LABEL[server.status]}</span>
          {rt.canEdit && <button className="icon-button" aria-label={`Quitar ${server.name}`} title="Quitar de este runtime" disabled={busy} onClick={() => remove(rt.runtime as 'claude' | 'codex', server.name)}><Trash2 size={14} /></button>}
        </div>)}
      </div>}
      {rt.installed && rt.canEdit && adding !== rt.runtime && <button className="subtle" disabled={busy} onClick={() => setAdding(rt.runtime as 'claude' | 'codex')}><Plus size={13} />{t('ui.auto.311')}</button>}
      {adding === rt.runtime && <AddServer runtime={rt.runtime as 'claude' | 'codex'} busy={busy} onCancel={() => setAdding(null)} onAdd={async input => {
        setBusy(true);
        try {
          await api.addMcpServer(rt.runtime as 'claude' | 'codex', input);
          setAdding(null);
          await load();
          onNotice(`«${input.name}» quedó configurado en ${RUNTIME_NAME[rt.runtime]}`);
        } catch (e) { onError(displayError(e)); } finally { setBusy(false); }
      }} />}
      {rt.installed && !rt.canEdit && <p className="footnote"><AlertTriangle size={13} />  {t('ui.auto.312')} <code>opencode mcp add</code>  {t('ui.auto.313')}</p>}
    </div>)}

    <p className="footnote">

      {t('ui.auto.314')}
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

  return <div className="chat-card mcp-form" role="group" aria-label={t('ui.auto.311')}>
    <div className="chat-card-title"><Plug size={15} />{t('ui.auto.315')} {RUNTIME_NAME[runtime]}</div>
    <label className="field-label" htmlFor={`mcp-name-${runtime}`}>{t('ui.auto.409')}</label>
    <input id={`mcp-name-${runtime}`} value={name} maxLength={64} placeholder="Ej. notion" onChange={e => setName(e.target.value)} />
    <label className="field-label" htmlFor={`mcp-transport-${runtime}`}>{t('ui.auto.316')}</label>
    <select id={`mcp-transport-${runtime}`} value={transport} onChange={e => setTransport(e.target.value as 'stdio' | 'http')}>
      <option value="stdio">{t('ui.auto.317')}</option>
      <option value="http">{t('ui.auto.318')}</option>
    </select>
    {transport === 'stdio' ? <>
      <label className="field-label" htmlFor={`mcp-command-${runtime}`}>{t('ui.auto.410')}</label>
      <input id={`mcp-command-${runtime}`} value={command} maxLength={400} placeholder="npx -y @modelcontextprotocol/server-filesystem" onChange={e => setCommand(e.target.value)} />
      <label className="field-label" htmlFor={`mcp-env-${runtime}`}>{t('ui.auto.319')}</label>
      <textarea id={`mcp-env-${runtime}`} className="context-editor short" value={envText} placeholder={'API_KEY=...'} onChange={e => setEnvText(e.target.value)} />
      <p className="footnote">{t('ui.auto.320')}</p>
    </> : <>
      <label className="field-label" htmlFor={t('ui.auto.411', { p0: runtime })}>{t('ui.auto.412')}</label>
      <input id={t('ui.auto.411', { p0: runtime })} value={url} maxLength={500} placeholder="https://mcp.ejemplo.com/mcp" onChange={e => setUrl(e.target.value)} />
      <p className="footnote">{t('ui.auto.321')} <code>{runtime} mcp login {name || t('ui.auto.413')}</code>  {t('ui.auto.322')}</p>
    </>}
    <div className="chat-card-actions">
      <button className="primary" disabled={busy || !ready} onClick={() => void onAdd({ name: name.trim(), transport, command: parts[0] ?? '', args: parts.slice(1), url: url.trim(), env })}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{t('ui.auto.261')}</button>
      <button disabled={busy} onClick={onCancel}><X size={14} />{t('ui.auto.241')}</button>
    </div>
  </div>;
}
