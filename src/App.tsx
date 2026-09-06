import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUpRight, Bookmark, Check, ChevronDown, Circle, Copy, FileText, Folder, LoaderCircle, Maximize2, MessageSquare, Minimize2, Minus, Plus, Save, Settings2, Square, TerminalSquare, X } from 'lucide-react';
import type { Brand, Work, Decision, RuntimeStatus, AgentSession, Provider, ChatSession, ChatRuntimeStatus, PrimaryAgent, AgentRuntimeInfo, AgentRole, TeamMember, TeamMemberOptions, WorkDocument, DocumentKind } from '../shared/contracts';
import { api, chatStore, isDesktop } from './browser-api';
import { DocumentsView, NewDocumentDialog } from './DocumentsView';
import { documentDrafts } from './document-drafts';
import { useActiveEdits } from './chat-store';
import { SettingsScreen, type SettingsSection } from './SettingsScreen';
import { TeamPanel, type RuntimeChoice } from './TeamPanel';
import { TerminalPane } from './TerminalPane';

type View = 'brief' | 'context' | 'memory' | 'decisions';
type Modal = 'brand' | 'work' | 'document' | null;
type AgentMode = 'chat' | 'terminal';
const date = (value: string) => new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const AGENT_WIDTH_KEY = 'latte-agent-width';
const AGENT_MIN = 320, SIDEBAR = 232, WORKSPACE_MIN = 360;
const maxAgentWidth = () => Math.max(AGENT_MIN, window.innerWidth - SIDEBAR - WORKSPACE_MIN);
const clampAgentWidth = (value: number) => Math.min(maxAgentWidth(), Math.max(AGENT_MIN, Math.round(value)));
const readAgentWidth = () => { try { const raw = localStorage.getItem(AGENT_WIDTH_KEY); const n = raw ? Number(raw) : NaN; return Number.isFinite(n) ? clampAgentWidth(n) : 355; } catch { return 355; } };
const displayError = (e: unknown) => e instanceof Error ? e.message : String(e);

/**
 * The window is frameless, so Latte draws its own controls. The title bar area
 * is draggable; every button opts out of dragging so it stays clickable.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => api.onWindowState(state => setMaximized(state.maximized)), []);
  return <div className="window-controls">
    <button aria-label="Minimizar" title="Minimizar" onClick={() => api.windowControl('minimize')}><Minus size={15} /></button>
    <button aria-label={maximized ? 'Restaurar' : 'Maximizar'} title={maximized ? 'Restaurar' : 'Maximizar'} onClick={() => api.windowControl('maximize')}>{maximized ? <Copy size={13} /> : <Square size={12} />}</button>
    <button className="close" aria-label="Cerrar" title="Cerrar" onClick={() => api.windowControl('close')}><X size={16} /></button>
  </div>;
}
export function App() {
  const [brands, setBrands] = useState<Brand[]>([]), [brand, setBrand] = useState<Brand | null>(null);
  const [works, setWorks] = useState<Work[]>([]), [work, setWork] = useState<Work | null>(null);
  const [context, setContext] = useState('');
  const [view, setView] = useState<View>('brief');
  // Documents of the current work: the editor lives in DocumentsView, App only tracks which one is open.
  const [documents, setDocuments] = useState<WorkDocument[]>([]), [selectedDoc, setSelectedDoc] = useState<Record<string, string>>({});
  const [documentDirty, setDocumentDirty] = useState(false);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [modal, setModal] = useState<Modal>(null), [name, setName] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([]), [provider, setProvider] = useState<Provider>('opencode');
  const [sessions, setSessions] = useState<Record<string, AgentSession>>({}), [starting, setStarting] = useState(false);
  const session = work ? sessions[work.id] ?? null : null;
  const setSession = (value: AgentSession | null) => setSessions(previous => { const next = { ...previous }; if (value) next[value.workId] = value; else if (work) delete next[work.id]; return next; });
  const [agentMode, setAgentMode] = useState<AgentMode>('chat');
  // Settings is a screen of its own: the workspace shell unmounts while it is open (no document controls in the DOM) and comes back untouched.
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  // The agent panel is resizable (drag its left edge) and can take most of the window for long conversations.
  const [agentWidth, setAgentWidth] = useState<number>(readAgentWidth), [dragging, setDragging] = useState(false), [expanded, setExpanded] = useState(false);
  const savedWidth = useRef(agentWidth);
  const persistWidth = (value: number) => { try { localStorage.setItem(AGENT_WIDTH_KEY, String(value)); } catch { /* per-viewer convenience only */ } };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); setDragging(true); setExpanded(false);
    const move = (ev: PointerEvent) => setAgentWidth(clampAgentWidth(window.innerWidth - ev.clientX));
    const up = (ev: PointerEvent) => { const w = clampAgentWidth(window.innerWidth - ev.clientX); setAgentWidth(w); savedWidth.current = w; persistWidth(w); setDragging(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const toggleExpanded = () => { if (expanded) { setAgentWidth(savedWidth.current); setExpanded(false); } else { savedWidth.current = agentWidth; setAgentWidth(maxAgentWidth()); setExpanded(true); } };
  useEffect(() => { const onResize = () => setAgentWidth(w => clampAgentWidth(expanded ? maxAgentWidth() : w)); window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize); }, [expanded]);
  // Team: live sessions by chat id (= member id), the persisted roster of the current work, and the selected member per work.
  const [chats, setChats] = useState<Record<string, ChatSession>>({}), [startingChat, setStartingChat] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]), [roles, setRoles] = useState<AgentRole[]>([]), [selectedMembers, setSelectedMembers] = useState<Record<string, string>>({});
  const [chatRuntime, setChatRuntime] = useState<ChatRuntimeStatus | null>(null);
  const [primary, setPrimary] = useState<PrimaryAgent | null>(null), [agentRuntimes, setAgentRuntimes] = useState<AgentRuntimeInfo[]>([]);
  const selectedMemberId = work ? selectedMembers[work.id] ?? null : null;
  const selectedChat = selectedMemberId ? chats[selectedMemberId] ?? null : null;
  const teamGeneration = useRef(0);
  const loadTeam = async (workId: string) => { const n = ++teamGeneration.current; const list = await api.listTeam(workId); if (n === teamGeneration.current) setTeam(list); return list; };
  const [prompt, setPrompt] = useState(''), [decision, setDecision] = useState('');
  const [memory, setMemory] = useState(''), [memoryAvailable, setMemoryAvailable] = useState(false), [memoryNote, setMemoryNote] = useState('');
  const [endedSessions, setEndedSessions] = useState<Set<string>>(new Set());
  const sessionEnded = Boolean(session && endedSessions.has(session.id));
  const generation = useRef(0), memoryGeneration = useRef(0);
  const dirty = documentDirty || documentDrafts.hasUnsaved(), contextDirty = Boolean(brand && context !== brand.context);
  const selectedDocId = work ? selectedDoc[work.id] ?? null : null;
  // Who is writing to which file right now, straight from each runtime's own
  // tool reports. A write that did not come through a tool is never attributed.
  const documentFileNames = documents.map(d => d.fileName);
  const liveEdits = useActiveEdits(chatStore, documentFileNames);
  const editors: Record<string, { roleId: string; roleName: string }> = {};
  for (const [chatId, files] of Object.entries(liveEdits)) {
    const session = chats[chatId];
    if (!session) continue;
    for (const file of files) editors[file] = { roleId: session.roleId, roleName: session.roleName };
  }
  const loadDocuments = async (workId: string) => { const list = await api.listDocuments(workId); setDocuments(list); return list; };
  const transitioning = busy || starting || startingChat;
  const guard = () => !transitioning && (!(dirty || contextDirty) || window.confirm('Tenés cambios sin guardar. ¿Querés descartarlos?'));
  const run = async (fn: () => Promise<void>) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(displayError(e)); } finally { setBusy(false); } };
  const refreshChatStatus = () => Promise.all([
    api.chatStatus().then(setChatRuntime).catch(e => setChatRuntime({ available: false, detail: displayError(e), version: null, models: [], defaultModel: null })),
    api.getPrimaryAgent().then(setPrimary).catch(() => setPrimary(null)),
    api.listAgentRuntimes().then(setAgentRuntimes).catch(() => setAgentRuntimes([])),
  ]).then(() => undefined);
  // The primary agent is chosen once in Providers; here we only say whether it can start.
  const primaryRuntime = primary?.runtime ?? 'opencode';
  const primaryAccount = primaryRuntime === 'opencode' ? null : agentRuntimes.find(r => r.runtime === primaryRuntime)?.accounts.find(a => a.id === (primary?.accountId ?? 'system')) ?? null;
  const primaryReady = primaryRuntime === 'opencode' ? Boolean(chatRuntime?.available) : Boolean(primaryAccount?.loggedIn);
  const primaryLabel = primary?.label ?? (chatRuntime?.defaultModel ? `OpenCode · ${chatRuntime.defaultModel}` : 'OpenCode · modelo por defecto');
  const activeRuntime = selectedChat?.provider ?? primaryRuntime;
  const runtimeName = activeRuntime === 'claude' ? 'Claude Code' : activeRuntime === 'codex' ? 'Codex' : 'OpenCode';
  const primaryDetail = primaryRuntime === 'opencode' ? (chatRuntime?.detail ?? 'Comprobando OpenCode…') : (primaryAccount ? primaryAccount.detail : `${primaryRuntime === 'claude' ? 'Claude Code' : 'Codex'}: cuenta no disponible`);
  // Alternatives to the primary agent when adding a member: every logged-in subscription account, plus OpenCode when configured.
  const runtimeChoices: RuntimeChoice[] = [
    ...agentRuntimes.flatMap(r => r.accounts.filter(a => a.loggedIn).map(a => ({ key: `${r.runtime}:${a.id}`, label: `${r.runtime === 'claude' ? 'Claude Code' : 'Codex'} · ${a.label}`, runtime: r.runtime, accountId: a.id }))),
    ...(chatRuntime?.available ? [{ key: 'opencode', label: `OpenCode · ${chatRuntime.defaultModel ?? 'modelo por defecto'}`, runtime: 'opencode' as const, accountId: null }] : []),
  ].filter(c => !(c.runtime === primaryRuntime && (c.runtime === 'opencode' || c.accountId === (primary?.accountId ?? 'system'))));
  useEffect(() => { void api.listBrands().then(list => { setBrands(list); if (list[0]) { setBrand(list[0]); setContext(list[0].context); } }).catch(e => setError(displayError(e))); void api.runtimeStatus().then(setRuntimes).catch(e => setError(displayError(e))); void api.listRoles().then(setRoles).catch(e => setError(displayError(e))); void refreshChatStatus(); }, []);
  useEffect(() => { if (!work) { setTeam([]); return; } void loadTeam(work.id).catch(e => setError(displayError(e))); }, [work?.id]);
  useEffect(() => { if (!brand) return; const n = ++generation.current; setWork(null); setWorks([]); setDecisions([]); setDocuments([]); void api.listWorks(brand.id).then(list => { if (n !== generation.current) return; setWorks(list); if (list[0]) setWork(list[0]); }).catch(e => setError(displayError(e))); }, [brand?.id]);
  useEffect(() => { if (!work) { setDocuments([]); setDecisions([]); return; } let active = true; void Promise.all([api.listDocuments(work.id), api.listDecisions(work.id)]).then(([docs, d]) => { if (active) { setDocuments(docs); setDecisions(d); } }).catch(e => setError(displayError(e))); return () => { active = false; }; }, [work?.id]);
  // Only real unsaved edits are worth a confirmation. Open chats and terminals
  // are not: closing the app is how you end them.
  const unsaved = dirty || contextDirty;
  useEffect(() => {
    // Desktop: report the state and let the main process ask with a native
    // dialog. A cancelled beforeunload shows nothing in Electron and would
    // leave the close button silently doing nothing.
    if (isDesktop) { api.reportUnsaved(unsaved); return; }
    // Web preview: the browser does show its own confirmation, so use it.
    const warn = (e: BeforeUnloadEvent) => { if (unsaved) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => api.onAgentEvent(event => { if (event.type === 'exit') { setEndedSessions(previous => new Set(previous).add(event.sessionId)); setNotice('Una sesión finalizó. Podés actualizar su documento desde disco.'); } if (event.type === 'error') setError(event.data); }), []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]') ?? []);
    if (!dialog?.contains(document.activeElement)) controls()[0]?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setModal(null); if (e.key !== 'Tab') return; const list = controls(); const first = list[0], last = list[list.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } };
    document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [modal, busy]);
  const selectBrand = (b: Brand) => { if (!guard()) return; setBrand(b); setContext(b.context); setView('brief'); setMemory(''); setMemoryAvailable(false); memoryGeneration.current++; };
  const selectWork = (w: Work) => { if (!guard()) return; setWork(w); setContext(brand?.context ?? ''); setView('brief'); };
  const saveContext = async () => { if (!brand) return; const b = await api.updateBrand(brand.id, context); setBrand(b); setBrands(prev => prev.map(x => x.id === b.id ? b : x)); setNotice('Contexto guardado'); };
  const onWorkUpdated = (updated: Work) => { setWork(updated); setWorks(prev => prev.map(x => x.id === updated.id ? updated : x)); };
  const openMemory = () => { setView('memory'); if (!brand) return; const n = ++memoryGeneration.current; setMemory('Recuperando memoria…'); void api.readMemory(brand.id).then(r => { if (n !== memoryGeneration.current) return; setMemory(r.text); setMemoryAvailable(r.available); }).catch(e => setError(displayError(e))); };
  const create = () => run(async () => { if (!name.trim()) return; if (!guard()) return; if (modal === 'brand') { const b = await api.createBrand(name.trim()); setBrands(prev => [...prev, b]); setBrand(b); setContext(b.context); } else if (brand) { const w = await api.createWork(brand.id, name.trim()); setWorks(prev => [...prev, w]); setWork(w); setContext(brand.context); } setView('brief'); setModal(null); setName(''); });
  const createDocument = async (kind: DocumentKind, title: string, baseDocumentId: string | null) => {
    if (!work) return;
    await run(async () => {
      const created = await api.createDocument(work.id, kind, title, baseDocumentId);
      await loadDocuments(work.id);
      setSelectedDoc(prev => ({ ...prev, [work.id]: created.document.id }));
      setModal(null);
      setNotice('Documento creado');
    });
  };
  /**
   * Points this work at a folder the person already uses. Latte then works in
   * it: no copy. It writes its context files there and agents get that folder,
   * so the confirmation says exactly that before anything happens.
   */
  const useFolder = () => {
    if (!work) return;
    const warning = [
      'Latte va a trabajar directamente en la carpeta que elijas. No copia nada.',
      '',
      'Dentro de esa carpeta va a crear o actualizar:',
      '  CLAUDE.md y AGENTS.md (contexto para los agentes)',
      '  README.md y .latte/ (versiones)',
      '',
      'Los agentes que abras van a tener esa carpeta como espacio de trabajo.',
      '',
      '¿Elegimos la carpeta?',
    ].join('\n');
    if (!window.confirm(warning)) return;
    void run(async () => {
      const result = await api.useFolder(work.id);
      if (!result) return;
      onWorkUpdated(result.work);
      await loadDocuments(work.id);
      const extra = result.otherFiles.length + result.subfolders.length;
      setNotice(result.documents.length > 0
        ? `Listo. ${result.documents.length} documento${result.documents.length === 1 ? '' : 's'} de esa carpeta ahora tienen versiones${extra ? `; hay ${extra} archivo(s) y carpeta(s) más que el agente puede leer` : ''}.`
        : 'Listo. La carpeta quedó vinculada; pedile al asistente que arme los documentos.');
    });
  };

  // Nothing is saved implicitly. Opening a member warns instead of writing the editor's text.
  const warnUnsaved = () => { if (dirty) setNotice('Tenés cambios sin guardar: el agente va a leer la versión guardada en disco.'); };
  const start = async () => { if (!work || starting || session) return; setStarting(true); setError(''); try { warnUnsaved(); const s = await api.startAgent(work.id, provider); setSession(s); setNotice('Sesión iniciada en el espacio del trabajo'); } catch (e) { setError(displayError(e)); } finally { setStarting(false); } };
  // Team actions. A member's chat id is its member id, so the store state follows it through pause and resume.
  const selectMember = (memberId: string) => { if (work) setSelectedMembers(prev => ({ ...prev, [work.id]: memberId })); };
  const openSession = async (open: () => Promise<ChatSession>, workId: string) => {
    setStartingChat(true); setError('');
    try { warnUnsaved(); const s = await open(); setChats(prev => ({ ...prev, [s.id]: s })); if (s.resumed) await chatStore.sync(s.id); setSelectedMembers(prev => ({ ...prev, [workId]: s.id })); await loadTeam(workId); setNotice(s.resumed ? `${s.roleName}: conversación reanudada` : `${s.roleName} se sumó al equipo`); }
    catch (e) { setError(displayError(e)); void refreshChatStatus(); throw e; }
    finally { setStartingChat(false); }
  };
  const addMember = async (roleId: string, options: TeamMemberOptions | null) => { if (!work || startingChat) return; await openSession(() => api.addTeamMember(work.id, roleId, options), work.id).catch(() => undefined); };
  const openMember = async (memberId: string) => { if (!work || startingChat) return; chatStore.forget(memberId); await openSession(() => api.openTeamMember(memberId), work.id).catch(() => undefined); };
  const dropChat = (memberId: string) => { setChats(prev => { const next = { ...prev }; delete next[memberId]; return next; }); chatStore.forget(memberId); };
  const pauseMember = (memberId: string) => run(async () => { await api.pauseTeamMember(memberId); dropChat(memberId); if (work) await loadTeam(work.id); });
  const finishMember = (memberId: string) => run(async () => { await api.finishTeamMember(memberId); dropChat(memberId); if (work) await loadTeam(work.id); setNotice('Miembro marcado como finalizado'); });
  const removeMember = (memberId: string) => run(async () => { await api.removeTeamMember(memberId); dropChat(memberId); if (work) { setSelectedMembers(prev => { const next = { ...prev }; if (next[work.id] === memberId) delete next[work.id]; return next; }); await loadTeam(work.id); } });
  const liveChatIds = new Set(Object.keys(chats));
  const workHasLiveChat = (workId: string) => Object.values(chats).some(c => c.workId === workId);
  const sessionWork = works.find(w => w.id === session?.workId);
  const activeTerminals = Object.values(sessions).filter(s => !endedSessions.has(s.id)).length, activeChats = liveChatIds.size;
  if (settings) return <SettingsScreen controls={isDesktop ? <WindowControls /> : null} section={settings} onSection={setSettings} onClose={() => { setSettings(null); setError(''); setNotice(''); }} onChanged={() => void refreshChatStatus()} onNotice={setNotice} onError={setError} notice={notice} error={error} onDismiss={() => { setError(''); setNotice(''); }} />;
  return <div className={'app-shell' + (dragging ? ' dragging' : '')} style={{ ['--agent-width' as string]: `${agentWidth}px` }}>
    <aside className="sidebar">
      <div className="wordmark"><span className="logo-mark" aria-hidden="true" />Latte<span className="alpha">ALPHA</span></div>
      <div className="brand-picker"><select aria-label="Marca activa" value={brand?.id ?? ''} onChange={e => { const b = brands.find(b => b.id === e.target.value); if (b) selectBrand(b); }}>{!brands.length && <option value="">Tu primera marca</option>}{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><ChevronDown size={15} /></div>
      <button className="subtle sidebar-add" disabled={transitioning} onClick={() => { setName(''); setModal('brand'); }}><Plus size={14} /> Agregar marca</button>
      <div className="nav-label">MARCA</div>
      <nav><button disabled={!brand} className={view === 'context' ? 'nav-active' : ''} onClick={() => setView('context')}><FileText size={18} />Contexto</button><button disabled={!brand} className={view === 'memory' ? 'nav-active' : ''} onClick={openMemory}><Bookmark size={18} />Memoria</button></nav>
      <div className="sidebar-rule" /><div className="nav-label">TRABAJOS <span>{works.length.toString().padStart(2, '0')}</span></div>
      <nav className="work-nav">{works.map(w => <button key={w.id} className={work?.id === w.id && (view === 'brief' || view === 'decisions') ? 'work-active' : ''} onClick={() => selectWork(w)}><Folder size={17} /><span>{w.title}</span>{(workHasLiveChat(w.id) || sessions[w.id]) && <i className={sessions[w.id] && endedSessions.has(sessions[w.id].id) && !workHasLiveChat(w.id) ? 'ended-dot' : 'live-dot'} />}</button>)}{!works.length && <p className="sidebar-hint">Un espacio para cada idea que querés llevar adelante.</p>}</nav>
      <div className="sidebar-bottom"><button disabled={!brand || transitioning} onClick={() => { setName(''); setModal('work'); }}><Plus size={20} />Nuevo trabajo</button><div className="sidebar-rule" /><nav><button onClick={() => setSettings('agents')}><Settings2 size={17} />Ajustes</button></nav><div className="profile"><span className="avatar">G</span><div>Tu estudio<small>Local · Sin cuenta de Latte</small></div></div></div>
    </aside>
    <header className="topbar"><div className="breadcrumb">{brand?.name ?? 'Bienvenido a Latte'}<span>/</span><strong>{work?.title ?? 'Tu espacio de marketing'}</strong></div><span className="local-badge"><i />{isDesktop ? 'Local' : 'Vista previa web'}</span>{isDesktop && <WindowControls />}</header>
    <main className="workspace">
      <div className="tabs"><button className={view === 'brief' ? 'selected' : ''} onClick={() => setView('brief')}>Documentos <span>{documents.length}</span></button><button className={view === 'decisions' ? 'selected' : ''} onClick={() => setView('decisions')}>Decisiones <span>{decisions.length}</span></button><div className="tab-spacer" /></div>
      {(error || notice) && <div role={error ? 'alert' : 'status'} className={'message ' + (error ? 'error' : '')}><span>{error || notice}</span><button aria-label="Cerrar aviso" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></button></div>}
      {view === 'brief' && <DocumentsView work={work} brandName={brand?.name ?? ''} documents={documents} selectedId={selectedDocId} onSelect={id => work && setSelectedDoc(prev => ({ ...prev, [work.id]: id }))} onDocumentsChanged={async () => { if (work) await loadDocuments(work.id); }} onWorkUpdated={onWorkUpdated} onDirtyChange={setDocumentDirty} onNotice={setNotice} onError={setError} onCreate={() => setModal('document')} onUseFolder={useFolder} editors={editors} busy={busy} />}
      {view === 'context' && <div className="document-scroll"><div className="document-kicker">EL PUNTO DE PARTIDA</div><h1>Una marca.<br />Un contexto compartido.</h1><p className="intro">Lo que el agente necesita saber: negocio, audiencia, tono, restricciones y decisiones vigentes. Se incorpora al iniciar cada sesión.</p><label className="field-label" htmlFor="brand-context">CONTEXTO DE {brand?.name}</label><textarea id="brand-context" className="context-editor" value={context} onChange={e => setContext(e.target.value)} placeholder="¿Qué ofrece la marca? ¿Para quién? ¿Qué no debemos asumir?" /><button className="primary" disabled={!contextDirty || busy} onClick={() => run(saveContext)}><Save size={16} />Guardar contexto</button><p className="footnote">Los cambios aplican a nuevas sesiones. No alteran retroactivamente el contexto de un agente en marcha.</p></div>}
      {view === 'decisions' && <div className="document-scroll"><div className="document-kicker">CRITERIO QUE PERMANECE</div><h1>No empezar<br />de cero otra vez.</h1><p className="intro">Registrá qué decidiste y por qué. Las decisiones pertenecen a este trabajo; no se convierten automáticamente en reglas de marca.</p>{work && <form className="decision-form" onSubmit={e => { e.preventDefault(); void run(async () => { if (!decision.trim()) return; await api.addDecision(work.id, decision.trim()); setDecisions(await api.listDecisions(work.id)); setDecision(''); }); }}><textarea aria-label="Nueva decisión" placeholder="Elegimos… porque…" value={decision} onChange={e => setDecision(e.target.value)} /><button className="primary" disabled={!decision.trim() || busy}><Plus size={15} />Registrar decisión</button></form>}<div className="decision-list">{decisions.map((d, i) => <div className="decision-card" key={d.id}><span className="decision-number">{String(i + 1).padStart(2, '0')}</span><div><p>{d.text}</p><small>{date(d.createdAt)}</small></div></div>)}{!decisions.length && <p className="footnote">Todavía no hay decisiones registradas.</p>}</div></div>}
      {view === 'memory' && <div className="document-scroll"><div className="document-kicker">MEMORIA DE MARCA · ENGRAM</div><h1>El trabajo sigue.<br />El contexto también.</h1><p className="intro">Conocimiento seleccionado, no una copia de cada conversación. Los recuerdos de esta marca se consultan por separado.</p><div className="memory-result"><ReactMarkdown remarkPlugins={[remarkGfm]}>{memory || 'Sin resultados.'}</ReactMarkdown></div><label className="field-label" htmlFor="memory-note">CONSERVAR UN APRENDIZAJE</label><textarea id="memory-note" className="context-editor short" value={memoryNote} onChange={e => setMemoryNote(e.target.value)} placeholder="Qué aprendimos, por qué importa y de dónde surge…" /><button className="primary" disabled={!memoryAvailable || !memoryNote.trim() || busy} onClick={() => run(async () => { const r = await api.saveMemory(brand!.id, memoryNote); if (!r.available) throw new Error(r.text); setMemoryNote(''); setNotice('Aprendizaje guardado en Engram'); openMemory(); })}><Bookmark size={15} />Guardar aprendizaje</button></div>}
      <div className="document-footer"><span><FileText size={13} />{work ? `${documents.length} documento${documents.length === 1 ? '' : 's'} en este trabajo` : 'Un espacio para tu criterio'}</span><span>{work ? date(work.updatedAt) : 'An Agent Marketing Platform'}</span></div>
    </main>
    <aside className="agent-panel"><button type="button" className={'panel-resizer' + (dragging ? ' dragging' : '')} aria-label="Ajustar ancho del panel del agente" title="Arrastrá para cambiar el ancho" onPointerDown={startResize} /><div className="agent-title">Tu equipo de trabajo<div className="agent-title-actions"><button className="icon-button" aria-label={expanded ? 'Reducir el chat' : 'Ampliar el chat'} title={expanded ? 'Reducir el chat' : 'Ampliar el chat'} onClick={toggleExpanded}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button><button className="icon-button" aria-label="Proveedores de IA" title="Proveedores de IA" onClick={() => setSettings('agents')}><Settings2 size={16} /></button></div></div>
      <div className="agent-mode-tabs" role="tablist" aria-label="Modo del agente"><button role="tab" aria-selected={agentMode === 'chat'} className={agentMode === 'chat' ? 'selected' : ''} onClick={() => setAgentMode('chat')}><MessageSquare size={15} />Conversación{liveChatIds.size > 0 && <span className="tag count">{liveChatIds.size}</span>}</button><button role="tab" aria-selected={agentMode === 'terminal'} className={agentMode === 'terminal' ? 'selected' : ''} onClick={() => setAgentMode('terminal')}><TerminalSquare size={15} />Terminal<span className="tag">AVANZADO</span></button></div>
      {agentMode === 'chat' && <TeamPanel work={work} team={team} chats={chats} selectedId={selectedMemberId} roles={roles} primaryLabel={primaryLabel} primaryDetail={primaryDetail} primaryReady={primaryReady} choices={runtimeChoices} busy={busy || startingChat} isDesktop={isDesktop} onSelect={selectMember} onAdd={addMember} onOpen={openMember} onPause={pauseMember} onFinish={finishMember} onRemove={removeMember} onProviders={() => setSettings('agents')} onRecheck={() => void refreshChatStatus()} onError={setError} />}
      {agentMode === 'terminal' && <><p className="agent-explanation">Tu CLI, con sus herramientas y su propia interfaz. Latte prepara el espacio y el contexto de este trabajo.</p><label className="field-label" htmlFor="provider">RUNTIME</label><select id="provider" value={provider} disabled={Boolean(session) || starting} onChange={e => setProvider(e.target.value as Provider)}>{(['opencode', 'claude', 'codex'] as Provider[]).map(p => <option key={p} value={p}>{p === 'opencode' ? 'OpenCode' : p === 'claude' ? 'Claude Code' : 'Codex'}{runtimes.find(r => r.provider === p)?.available ? ' · Detectado' : ''}</option>)}</select><p className="runtime-detail">{runtimes.find(r => r.provider === provider)?.detail ?? 'Comprobando disponibilidad…'}</p>
        <div className="terminal-stack">{Object.values(sessions).map(s => <div key={s.id} style={{ display: s.id === session?.id ? 'block' : 'none' }}><TerminalPane sessionId={s.id} onError={setError} /></div>)}</div>
        {session ? <><div className="session-heading"><span><i className={sessionEnded ? 'ended-dot' : 'live-dot'} />{session.provider} · {sessionWork?.title ?? 'Trabajo de la sesión'}</span><button aria-label="Detener agente" title="Detener agente" onClick={() => run(async () => { await api.stopAgent(session.id); setSession(null); })}><Square size={13} /></button></div><form className="prompt-form" onSubmit={e => { e.preventDefault(); if (!prompt.trim() || sessionEnded) return; void run(async () => { await api.writeAgent(session.id, prompt + '\r'); setPrompt(''); }); }}><textarea aria-label="Mensaje al agente" placeholder="¿Qué trabajamos ahora?" value={prompt} onChange={e => setPrompt(e.target.value)} /><div><small>{sessionEnded ? 'Sesión finalizada' : 'Se envía al CLI activo'}</small><button className="primary icon-button" disabled={!prompt.trim() || busy || sessionEnded} aria-label="Enviar mensaje"><ArrowUpRight size={18} /></button></div></form></> : <div className="agent-idle"><div className="agent-symbol"><TerminalSquare size={27} /></div><h3>Una terminal real<br />para tu CLI.</h3><p>Iniciá una sesión con tu CLI instalado. Sus permisos y autenticación siguen bajo tu control.</p><button className="primary" disabled={!work || starting || !runtimes.find(r => r.provider === provider)?.available} onClick={start}>{starting ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{starting ? 'Iniciando…' : 'Iniciar agente'}</button>{!isDesktop && <small className="preview-note">La vista web guarda en este navegador. Para ejecutar agentes, abrí Latte Desktop.</small>}</div>}</>}
      <div className="active-context"><div className="field-label">CONTEXTO PARA NUEVAS SESIONES</div><span><FileText size={13} />{brand?.context ? 'Contexto de marca' : 'Marca sin contexto'}</span><span><Folder size={13} />{work?.title ?? 'Sin trabajo seleccionado'}</span><span><Bookmark size={13} />{decisions.length} decisiones registradas</span></div><p className="agent-footnote">No se simulan respuestas de IA. Cada miembro del equipo usa {runtimeName} u otro runtime instalado en tu equipo; la terminal ejecuta tu CLI tal cual es.</p>
    </aside>
    <footer className="statusbar"><span><Circle size={11} />{isDesktop ? `Espacio local · ${activeChats} chats · ${activeTerminals} terminales` : 'Previsualización · localStorage'}</span><span>{busy ? 'Procesando…' : dirty || contextDirty ? 'Cambios sin guardar' : 'Todo guardado'}<Check size={13} /></span><span>Latte <span className="status-version">0.1 / ALPHA</span></span></footer>
    {(modal === 'brand' || modal === 'work') && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="modal"><div className="modal-head"><div><div className="document-kicker">TU ESTUDIO, CON ORDEN</div><h2 id="dialog-title">{modal === 'brand' ? 'Una nueva marca.' : 'Un nuevo trabajo.'}</h2></div><button className="modal-close" aria-label="Cerrar" onClick={() => setModal(null)}><X size={20} /></button></div><div className="modal-body"><form onSubmit={e => { e.preventDefault(); void create(); }}><label className="field-label" htmlFor="new-name">{modal === 'brand' ? 'NOMBRE DE LA MARCA' : 'TÍTULO DEL TRABAJO'}</label><input autoFocus id="new-name" maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder={modal === 'brand' ? 'Ej. Casa Oliva' : 'Ej. Investigación de audiencia'} /><p className="footnote">Podés empezar con lo que sabés e incorporar contexto después.</p><button className="primary" disabled={!name.trim() || busy}>Crear {modal === 'brand' ? 'marca' : 'trabajo'}<ArrowUpRight size={16} /></button></form></div></section></div>}
    {modal === 'document' && <NewDocumentDialog documents={documents} busy={busy} onCancel={() => setModal(null)} onCreate={createDocument} />}
  </div>;
}
