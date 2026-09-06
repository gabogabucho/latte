import { useEffect, useState } from 'react';
import { Check, ExternalLink, KeyRound, LoaderCircle, LogIn, LogOut, Plug, Plus, Star, Trash2, Unplug } from 'lucide-react';
import type { AgentAccount, AgentRuntimeInfo, PrimaryAgent, ProviderInfo, ProviderOAuthStart } from '../shared/contracts';
import { agentBus, api, isDesktop } from './browser-api';
import { TerminalPane } from './TerminalPane';

const displayError = (e: unknown) => (e instanceof Error ? e.message : String(e));
const RUNTIME_NAME: Record<'claude' | 'codex', string> = { claude: 'Claude Code', codex: 'Codex' };

/**
 * One place to decide who does the work. Subscription runtimes (Claude Code,
 * Codex) log in with their own OAuth inside an embedded terminal; API
 * providers go through the OpenCode runtime. Whatever is marked as primary is
 * what a new chat uses, silently. Latte never stores a secret itself.
 */
export function ProvidersView({ onChanged, onNotice, onError }: { onChanged: () => void; onNotice: (text: string) => void; onError: (text: string) => void }) {
  const [primary, setPrimary] = useState<PrimaryAgent | null>(null);
  const [runtimes, setRuntimes] = useState<AgentRuntimeInfo[] | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<{ runtime: 'claude' | 'codex'; accountId: string; sessionId: string | null; url: string | null; instructions: string; ended: boolean } | null>(null);
  const [newAccount, setNewAccount] = useState<{ runtime: 'claude' | 'codex'; label: string } | null>(null);
  const [selected, setSelected] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [oauth, setOauth] = useState<{ providerId: string; methodIndex: number; start: ProviderOAuthStart } | null>(null);
  const [code, setCode] = useState('');
  const [modelChoice, setModelChoice] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [p, r, list] = await Promise.all([api.getPrimaryAgent(), api.listAgentRuntimes(), api.listProviders()]);
      setPrimary(p);
      setRuntimes(r);
      setProviders(list);
      if (!selected) {
        const first = list.find(x => !x.connected);
        if (first) setSelected(first.id);
      }
    } catch (e) {
      onError(displayError(e));
      setRuntimes(r => r ?? []);
      setProviders(p => p ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // A login runs in an embedded terminal; when the CLI exits we re-check who is logged in.
  useEffect(() => {
    if (!login || login.ended || !login.sessionId) return;
    return agentBus.subscribe(login.sessionId, event => {
      if (event.type === 'exit') {
        setLogin(current => (current && current.sessionId === login.sessionId ? { ...current, ended: true } : current));
        void load().then(onChanged);
      }
    }, false);
  }, [login?.sessionId]);

  const run = async (fn: () => Promise<void>, notice?: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
      if (notice) onNotice(notice);
    } catch (e) {
      onError(displayError(e));
    } finally {
      setBusy(false);
    }
  };

  const makePrimary = (choice: { runtime: 'opencode' | 'claude' | 'codex'; model: string | null; accountId: string | null }) =>
    run(async () => { const p = await api.setPrimaryAgent(choice); setPrimary(p); }, 'Agente principal actualizado');

  const startLogin = (account: AgentAccount) => run(async () => {
    const start = await api.startAccountLogin(account.runtime, account.id);
    if (start.mode === 'terminal') setLogin({ runtime: account.runtime, accountId: account.id, sessionId: start.sessionId, url: null, instructions: start.instructions, ended: false });
    else setLogin({ runtime: account.runtime, accountId: account.id, sessionId: null, url: start.url, instructions: start.instructions, ended: false });
  });

  const isPrimaryAccount = (a: AgentAccount) => primary?.runtime === a.runtime && (primary.accountId ?? 'system') === a.id;

  if (!isDesktop) {
    return <div className="document-scroll"><div className="document-kicker">PROVEEDORES</div><h1>Tus modelos,<br />tus credenciales.</h1><p className="intro">La conexión con proveedores de IA se hace desde Latte Desktop, donde corren los runtimes locales. Esta vista web no guarda credenciales.</p></div>;
  }

  const connected = providers?.filter(p => p.connected) ?? [];
  const available = providers?.filter(p => !p.connected) ?? [];
  const current = providers?.find(p => p.id === selected) ?? null;
  const oauthMethods = current?.methods.filter(m => m.type === 'oauth') ?? [];

  // Configuration form, not an article: the Settings screen owns the title and the lead.
  return <div className="providers-view">

    <section className="providers-section primary-section">
      <div className="field-label">AGENTE PRINCIPAL</div>
      <div className="primary-card"><Star size={16} /><div><strong>{primary?.label ?? 'Sin elegir'}</strong><small>{primary ? 'Es lo que usa cada chat nuevo. Cambialo con «Usar como principal».' : 'Hasta que elijas, se usa OpenCode con su modelo por defecto.'}</small></div></div>
    </section>

    <section className="providers-section">
      <div className="field-label">CON TU SUSCRIPCIÓN</div>
      {loading && !runtimes && <p className="footnote"><LoaderCircle className="spin" size={13} /> Consultando runtimes…</p>}
      {runtimes?.map(rt => <div className="runtime-card" key={rt.runtime}>
        <div className="runtime-head"><strong>{RUNTIME_NAME[rt.runtime]}</strong><small>{rt.detail}</small></div>
        {rt.installed && <div className="provider-list">
          {rt.accounts.map(a => <div className={'provider-card' + (isPrimaryAccount(a) ? ' is-primary' : '')} key={a.id}>
            <span className={'provider-status' + (a.loggedIn ? '' : ' off')}>{a.loggedIn ? <Check size={14} /> : <LogIn size={14} />}</span>
            <div><strong>{a.label}{isPrimaryAccount(a) && <em className="tag">PRINCIPAL</em>}</strong><small>{a.detail}</small></div>
            <div className="provider-actions">
              {a.loggedIn && !isPrimaryAccount(a) && <button disabled={busy} title="Usar esta cuenta para los chats nuevos" onClick={() => makePrimary({ runtime: rt.runtime, model: null, accountId: a.id })}><Star size={13} />Usar como principal</button>}
              {!a.loggedIn && <button className="primary" disabled={busy || Boolean(login && !login.ended)} onClick={() => startLogin(a)}><LogIn size={13} />Iniciar sesión</button>}
              {a.loggedIn && <button disabled={busy} onClick={() => { if (window.confirm(`¿Cerrar la sesión de ${RUNTIME_NAME[rt.runtime]} (${a.label})?`)) void run(() => api.logoutAccount(a.runtime, a.id), 'Sesión cerrada'); }}><LogOut size={13} />Cerrar sesión</button>}
              {!a.system && <button disabled={busy} title="Quitar este perfil de Latte" onClick={() => { if (window.confirm(`¿Quitar el perfil ${a.label}? Se borra su carpeta gestionada.`)) void run(() => api.removeAgentAccount(a.runtime, a.id), 'Perfil quitado'); }}><Trash2 size={13} /></button>}
            </div>
          </div>)}
          {login && login.runtime === rt.runtime && <div className="chat-card login-card" role="group" aria-label="Inicio de sesión en curso">
            <div className="chat-card-title"><Plug size={15} />{login.ended ? 'Login finalizado' : login.url ? 'Login en el navegador' : 'Iniciando sesión…'}</div>
            <p>{login.instructions}</p>
            {login.url && <p><a href={login.url} target="_blank" rel="noreferrer">Abrir el enlace de nuevo <ExternalLink size={12} /></a></p>}
            {!login.ended && login.sessionId && <TerminalPane sessionId={login.sessionId} onError={onError} />}
            <div className="chat-card-actions">
              {login.ended ? <button onClick={() => setLogin(null)}>Cerrar</button> : login.url ? <><button className="primary" disabled={busy} onClick={() => void run(async () => { setLogin(null); }, 'Estado actualizado')}><Check size={14} />Ya inicié sesión</button><button disabled={busy} onClick={() => setLogin(null)}>Cancelar</button></> : <button disabled={busy} onClick={() => void run(async () => { if (login.sessionId) await api.stopAgent(login.sessionId); setLogin(null); })}>Cancelar</button>}
            </div>
          </div>}
          {newAccount?.runtime === rt.runtime ? <form className="provider-key" onSubmit={e => { e.preventDefault(); if (!newAccount.label.trim()) return; void run(async () => { await api.addAgentAccount(rt.runtime, newAccount.label.trim()); setNewAccount(null); }, 'Perfil creado. Ahora iniciá sesión.'); }}>
            <div className="provider-key-row"><input autoFocus aria-label="Nombre del perfil" placeholder="Ej. Cuenta de la agencia" value={newAccount.label} onChange={e => setNewAccount({ runtime: rt.runtime, label: e.target.value })} /><button className="primary" disabled={busy || !newAccount.label.trim()}>Crear</button><button type="button" onClick={() => setNewAccount(null)}>Cancelar</button></div>
            <p className="footnote">Un perfil es una carpeta propia de {RUNTIME_NAME[rt.runtime]} dentro de Latte: te permite usar otra cuenta sin tocar tu sesión habitual.</p>
          </form> : <button className="subtle" disabled={busy} onClick={() => setNewAccount({ runtime: rt.runtime, label: '' })}><Plus size={13} />Agregar otra cuenta</button>}
        </div>}
      </div>)}
    </section>

    <section className="providers-section">
      <div className="field-label">CON API KEY · VÍA OPENCODE {providers ? `· ${connected.length} conectados` : ''}</div>
      {loading && !providers && <p className="footnote"><LoaderCircle className="spin" size={13} /> Consultando el runtime…</p>}
      {providers && connected.length === 0 && <p className="footnote">Todavía no hay proveedores conectados por API.</p>}
      <div className="provider-list">
        {connected.map(p => {
          const chosen = modelChoice[p.id] ?? p.models[0] ?? '';
          const isPrimary = primary?.runtime === 'opencode' && primary.model?.startsWith(`${p.id}/`);
          return <div className={'provider-card' + (isPrimary ? ' is-primary' : '')} key={p.id}>
            <span className="provider-status"><Check size={14} /></span>
            <div><strong>{p.name}{isPrimary && <em className="tag">PRINCIPAL</em>}</strong><small>{p.models.length} modelo{p.models.length === 1 ? '' : 's'} · <code>{p.id}</code>{isPrimary && primary?.model ? ` · ${primary.model.split('/').slice(1).join('/')}` : ''}</small>
              {p.models.length > 0 && <div className="provider-model-row">
                <select aria-label={`Modelo de ${p.name}`} value={chosen} disabled={busy} onChange={e => setModelChoice(prev => ({ ...prev, [p.id]: e.target.value }))}>{p.models.map(m => <option key={m} value={m}>{m}</option>)}</select>
                <button disabled={busy || !chosen || (isPrimary && primary?.model === `${p.id}/${chosen}`)} onClick={() => makePrimary({ runtime: 'opencode', model: `${p.id}/${chosen}`, accountId: null })}><Star size={13} />Usar como principal</button>
              </div>}
            </div>
            <div className="provider-actions"><button disabled={busy} onClick={() => { if (window.confirm(`¿Desconectar ${p.name}?`)) void run(() => api.disconnectProvider(p.id), `${p.name} desconectado`); }} title="Quitar credenciales del runtime"><Unplug size={14} />Desconectar</button></div>
          </div>;
        })}
      </div>

      <div className="field-label" style={{ marginTop: 22 }}>CONECTAR UN PROVEEDOR</div>
      <label className="visually-hidden" htmlFor="provider-select">Proveedor</label>
      <select id="provider-select" value={selected} disabled={busy || !providers} onChange={e => { setSelected(e.target.value); setOauth(null); setApiKey(''); }}>
        {!available.length && <option value="">Sin proveedores disponibles</option>}
        {available.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {current && !current.connected && <div className="provider-connect">
        {oauthMethods.length > 0 && <div className="provider-methods">
          <p>Iniciar sesión con tu cuenta:</p>
          {oauthMethods.map(m => <button key={m.index} className="primary" disabled={busy} onClick={() => run(async () => { const start = await api.startProviderOAuth(current.id, m.index, {}); setOauth({ providerId: current.id, methodIndex: m.index, start }); setCode(''); })}><ExternalLink size={14} />{m.label}</button>)}
        </div>}
        {oauth && oauth.providerId === current.id && <div className="chat-card provider-oauth" role="group" aria-label="Inicio de sesión en curso">
          <div className="chat-card-title"><Plug size={15} />Login en el navegador</div>
          <p>{oauth.start.instructions || 'Completá el inicio de sesión en tu navegador.'}</p>
          <p><a href={oauth.start.url} target="_blank" rel="noreferrer">Abrir el enlace de nuevo <ExternalLink size={12} /></a></p>
          {oauth.start.method === 'code' && <input aria-label="Código de autorización" placeholder="Pegá el código que muestra el navegador" value={code} onChange={e => setCode(e.target.value)} />}
          <div className="chat-card-actions">
            <button className="primary" disabled={busy || (oauth.start.method === 'code' && !code.trim())} onClick={() => run(async () => { await api.completeProviderOAuth(oauth.providerId, oauth.methodIndex, oauth.start.method === 'code' ? code : null); setOauth(null); }, 'Sesión iniciada con el proveedor')}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{oauth.start.method === 'code' ? 'Completar con el código' : 'Ya inicié sesión'}</button>
            <button disabled={busy} onClick={() => setOauth(null)}>Cancelar</button>
          </div>
        </div>}
        <form className="provider-key" onSubmit={e => { e.preventDefault(); if (!apiKey.trim()) return; void run(async () => { await api.connectProviderKey(current.id, apiKey); setApiKey(''); }, `${current.name} conectado. Marcá un modelo como principal para usarlo.`); }}>
          <label className="field-label" htmlFor="provider-key">{oauthMethods.length ? 'O PEGÁ UNA API KEY' : 'API KEY'}</label>
          <div className="provider-key-row">
            <input id="provider-key" type="password" autoComplete="off" spellCheck={false} placeholder={`API key de ${current.name}`} value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <button className="primary" disabled={busy || !apiKey.trim()}>{busy ? <LoaderCircle className="spin" size={14} /> : <KeyRound size={14} />}Conectar</button>
          </div>
          <p className="footnote">La clave se envía al runtime local por loopback y queda en su almacén de credenciales, no en Latte.</p>
        </form>
      </div>}
    </section>
  </div>;
}
