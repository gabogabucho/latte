import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUpRight, Bookmark, Check, ChevronDown, Circle, Copy, FileText, Folder, LoaderCircle, MessageSquare, Minus, PanelLeftClose, PanelLeftOpen, Plus, Save, Settings2, Square, TerminalSquare, X } from 'lucide-react';
import type { Brand, Work, Decision, RuntimeStatus, AgentSession, Provider, ChatSession, ChatRuntimeStatus, PrimaryAgent, AgentRuntimeInfo, AgentRole, TeamMember, TeamMemberOptions, WorkDocument, DocumentKind, UntrackedFile, HandoffRequest } from '../shared/contracts';
import { api, chatStore, isDesktop } from './browser-api';
import { DocumentsView, NewDocumentDialog } from './DocumentsView';
import { hasMetadataDrafts } from './DocumentMetadata';
import { documentDrafts } from './document-drafts';
import { useActiveEdits } from './chat-store';
import { SettingsScreen, type SettingsSection } from './SettingsScreen';
import { TeamPanel, type RuntimeChoice } from './TeamPanel';
import { TerminalPane } from './TerminalPane';
import { UpdateBanner } from './UpdateBanner';

type View = 'brief' | 'funnel' | 'context' | 'memory' | 'decisions';
type Modal = 'brand' | 'work' | 'document' | null;
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
  // Collapsed to a rail: every label hides, every icon and its tooltip stay.
  const [railed, setRailed] = useState(() => { try { return localStorage.getItem('latte:rail') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('latte:rail', railed ? '1' : '0'); } catch { /* private window */ } }, [railed]);
  // Documents of the current work: the editor lives in DocumentsView, App only tracks which one is open.
  const [documents, setDocuments] = useState<WorkDocument[]>([]), [selectedDoc, setSelectedDoc] = useState<Record<string, string>>({});
  const [documentDirty, setDocumentDirty] = useState(false);
  const [profileDirty,setProfileDirty]=useState(false);
  const [untracked, setUntracked] = useState<UntrackedFile[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffRequest[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [modal, setModal] = useState<Modal>(null), [name, setName] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([]), [provider, setProvider] = useState<Provider>('opencode');
  const [sessions, setSessions] = useState<Record<string, AgentSession>>({}), [starting, setStarting] = useState(false);
  const session = work ? sessions[work.id] ?? null : null;
  const setSession = (value: AgentSession | null) => setSessions(previous => { const next = { ...previous }; if (value) next[value.workId] = value; else if (work) delete next[work.id]; return next; });
  // Settings is a screen of its own: the workspace shell unmounts while it is open (no document controls in the DOM) and comes back untouched.
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  // Review retains its resizable split; conversation focus leaves that width untouched.
  const [agentWidth, setAgentWidth] = useState<number>(readAgentWidth), [dragging, setDragging] = useState(false);
  const [layout, setLayout] = useState<'conversation' | 'review'>('conversation');
  const focusChat = Boolean(work) && layout === 'conversation' && view === 'brief';
  useEffect(() => { setLayout('conversation'); }, [work?.id]);
  const persistWidth = (value: number) => { try { localStorage.setItem(AGENT_WIDTH_KEY, String(value)); } catch { /* per-viewer convenience only */ } };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); setDragging(true);
    const move = (ev: PointerEvent) => setAgentWidth(clampAgentWidth(window.innerWidth - ev.clientX));
    const up = (ev: PointerEvent) => { const w = clampAgentWidth(window.innerWidth - ev.clientX); setAgentWidth(w); persistWidth(w); setDragging(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  useEffect(() => { const onResize = () => setAgentWidth(w => clampAgentWidth(w)); window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize); }, []);
  // Team: live sessions by chat id (= member id), the persisted roster of the current work, and the selected member per work.
  const [chats, setChats] = useState<Record<string, ChatSession>>({}), [startingChat, setStartingChat] = useState(false);
  const [trustedFolder, setTrustedFolder] = useState(false);
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
  const dirty = profileDirty || documentDirty || documentDrafts.hasUnsaved() || hasMetadataDrafts(), contextDirty = Boolean(brand && context !== brand.context);
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
  const loadDocuments = async (workId: string) => {
    const list = await api.listDocuments(workId);
    setDocuments(list);
    // An agent can create a file but cannot register it: Latte finds it and offers to adopt it.
    void api.listUntrackedFiles(workId).then(setUntracked).catch(() => setUntracked([]));
    // An agent can ask for a colleague the same way: by leaving a file.
    void api.listHandoffs(workId).then(setHandoffs).catch(() => setHandoffs([]));
    return list;
  };
  /** Saves an answer from the conversation as a document of this work. */
  const saveAnswerAsDocument = (text: string) => {
    if (!work) return;
    const title = window.prompt('¿Con qué título guardamos esta respuesta como documento?', 'Estrategia');
    if (!title || !title.trim()) return;
    const guess = /calendario|cronograma/i.test(title) ? 'calendar' : /estrateg/i.test(title) ? 'strategy' : /investigac|research/i.test(title) ? 'research' : /copy|pieza/i.test(title) ? 'copy' : 'note';
    void run(async () => {
      const document = await api.saveAsDocument(work.id, guess as DocumentKind, title.trim(), text);
      await loadDocuments(work.id);
      setSelectedDoc(prev => ({ ...prev, [work.id]: document.id }));
      setLayout('review'); setView('brief');
      setNotice(`${document.title} quedó como documento con versiones`);
    });
  };

  const trackFile = async (fileName: string) => {
    if (!work) return;
    await run(async () => {
      const document = await api.trackFile(work.id, fileName);
      await loadDocuments(work.id);
      setSelectedDoc(prev => ({ ...prev, [work.id]: document.id }));
      setLayout('review'); setView('brief');
      setNotice(`${document.title} ahora es un documento con versiones`);
    });
  };
  const transitioning = busy || starting || startingChat;
  const guard = () => !transitioning && (!(dirty || contextDirty) || window.confirm('Tenés cambios sin guardar. ¿Querés descartarlos?'));
  const run = async (fn: () => Promise<void>) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(displayError(e)); } finally { setBusy(false); } };
  // True until the first detection answers. The runtimes are found by running
  // their CLIs, which costs seconds: an empty list means "not asked yet", and
  // the UI has to say that instead of offering nothing.
  const [checkingAgents, setCheckingAgents] = useState(true);
  const refreshChatStatus = () => {
    setCheckingAgents(true);
    return Promise.all([
      api.chatStatus().then(setChatRuntime).catch(e => setChatRuntime({ available: false, detail: displayError(e), version: null, models: [], defaultModel: null })),
      api.getPrimaryAgent().then(setPrimary).catch(() => setPrimary(null)),
      api.listAgentRuntimes().then(setAgentRuntimes).catch(() => setAgentRuntimes([])),
    ]).then(() => { setCheckingAgents(false); });
  };
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
  useEffect(() => { if (!work) { setTeam([]); setTrustedFolder(false); return; } void loadTeam(work.id).catch(e => setError(displayError(e))); void api.getFolderTrust(work.id).then(setTrustedFolder).catch(() => setTrustedFolder(false)); }, [work?.id]);
  useEffect(() => { if (!brand) return; const n = ++generation.current; setWork(null); setWorks([]); setDecisions([]); setDocuments([]); void api.listWorks(brand.id).then(list => { if (n !== generation.current) return; setWorks(list); if (list[0]) setWork(list[0]); }).catch(e => setError(displayError(e))); }, [brand?.id]);
  useEffect(() => { if (!work) { setDocuments([]); setDecisions([]); setUntracked([]); setHandoffs([]); return; } let active = true; void Promise.all([api.listDocuments(work.id), api.listDecisions(work.id), api.listUntrackedFiles(work.id).catch(() => []), api.listHandoffs(work.id).catch(() => [])]).then(([docs, d, untrackedFiles, asks]) => { if (active) { setDocuments(docs); setDecisions(d); setUntracked(untrackedFiles); setHandoffs(asks); } }).catch(e => setError(displayError(e))); return () => { active = false; }; }, [work?.id]);
  /**
   * When an agent finishes a turn, look at the folder again.
   *
   * An agent writes files directly to disk and has no way to register them, so
   * without this Latte kept showing the folder as it was before the agent
   * worked: the new file stayed invisible, the offer to adopt it never
   * appeared, and saving the answer produced a second copy of the same thing.
   * A real run is what surfaced it; the turn ending is the honest moment to look.
   */
  const workChatIds = Object.values(chats).filter(c => work && c.workId === work.id).map(c => c.id).join(',');
  useEffect(() => {
    if (!work) return;
    const ids = workChatIds ? workChatIds.split(',') : [];
    if (ids.length === 0) return;
    const anyBusy = () => ids.some(id => chatStore.get(id).status !== 'idle');
    let wasBusy = anyBusy();
    return chatStore.subscribe(() => {
      const busyNow = anyBusy();
      if (wasBusy && !busyNow) void loadDocuments(work.id).catch(() => undefined);
      wasBusy = busyNow;
    });
  }, [work?.id, workChatIds]);
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
      // A template is an empty structure on purpose: nobody wants invented data.
      // But a derived document that stays empty is a dead end, so the ask to
      // fill it is written out here and left in the chat for review, not sent.
      const base = baseDocumentId ? documents.find(d => d.id === baseDocumentId) : null;
      if (!base) { setNotice('Documento creado'); return; }
      const ask = `Completá ${created.document.fileName} a partir de ${base.fileName}. Escribí el archivo en este turno con lo que ya tengamos, y marcá cada hueco como PENDIENTE: qué falta y por qué importa.`;
      const open = selectedMemberId && chats[selectedMemberId] ? chats[selectedMemberId] : Object.values(chats).find(c => c.workId === work.id) ?? null;
      if (!open) { setNotice(`${created.document.title} quedó con la estructura vacía. Sumá a alguien al equipo y pedile que lo complete desde ${base.title}.`); return; }
      chatStore.setDraft(open.id, ask);
      setSelectedMembers(prev => ({ ...prev, [work.id]: open.id }));
      setNotice(`${created.document.title} quedó con la estructura vacía. Le dejé preparado el pedido a ${open.roleName}: revisalo y enviá.`);
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
    try { warnUnsaved(); const s = await open(); setChats(prev => ({ ...prev, [s.id]: s })); if (s.resumed) await chatStore.sync(s.id); setSelectedMembers(prev => ({ ...prev, [workId]: s.id })); await loadTeam(workId); setNotice(s.resumed ? `${s.roleName}: conversación reanudada` : `${s.roleName} se sumó al equipo`); return s; }
    catch (e) { setError(displayError(e)); void refreshChatStatus(); throw e; }
    finally { setStartingChat(false); }
  };
  const addMember = async (roleId: string, options: TeamMemberOptions | null) => { if (!work || startingChat) return; await openSession(() => api.addTeamMember(work.id, roleId, options), work.id).catch(() => undefined); };
  const openMember = async (memberId: string) => { if (!work || startingChat) return; chatStore.forget(memberId); await openSession(() => api.openTeamMember(memberId), work.id).catch(() => undefined); };
  /**
   * The grant is a start-time flag of the agent process, so a conversation
   * already running would not see it. Rather than say "next time", the idle
   * Claude members are reopened right here: pause and resume keeps their
   * history. One that is mid-answer is left alone and named.
   */
  const trustFolder = (next: boolean) => {
    if (!work) return;
    void run(async () => {
      await api.setFolderTrust(work.id, next);
      setTrustedFolder(next);
      const claudeChats = Object.values(chats).filter(c => c.workId === work.id && c.provider === 'claude');
      const busyNames = claudeChats.filter(c => chatStore.get(c.id).status !== 'idle').map(c => c.roleName);
      const idle = claudeChats.filter(c => chatStore.get(c.id).status === 'idle');
      for (const chat of idle) {
        await api.pauseTeamMember(chat.id);
        chatStore.forget(chat.id);
        const reopened = await api.openTeamMember(chat.id);
        setChats(prev => ({ ...prev, [reopened.id]: reopened }));
        await chatStore.sync(reopened.id);
      }
      if (work) await loadTeam(work.id);
      const applied = next ? 'Listo, escriben en esta carpeta sin preguntar.' : 'Vuelven a pedir permiso por cada archivo.';
      setNotice(busyNames.length > 0
        ? `${applied} ${busyNames.join(' y ')} está respondiendo: le aplica cuando termine y la reanudes.`
        : applied);
    });
  };
  const dropChat = (memberId: string) => { setChats(prev => { const next = { ...prev }; delete next[memberId]; return next; }); chatStore.forget(memberId); };
  const pauseMember = (memberId: string) => run(async () => { await api.pauseTeamMember(memberId); dropChat(memberId); if (work) await loadTeam(work.id); });
  const finishMember = (memberId: string) => run(async () => { await api.finishTeamMember(memberId); dropChat(memberId); if (work) await loadTeam(work.id); setNotice('Miembro marcado como finalizado'); });
  const acceptHandoff = (handoff: HandoffRequest) => run(async () => {
    if (!work || startingChat) return;
    const existing = team.find(m => m.roleId === handoff.roleId);
    const session = existing
      ? await openSession(() => api.openTeamMember(existing.id), work.id)
      : await openSession(() => api.addTeamMember(work.id, handoff.roleId), work.id);
    if (!session) return;
    // Loaded, never sent: the request is a draft you read before it costs anything.
    chatStore.setDraft(session.id, handoff.request);
    // Reveal the conversation without unmounting or saving the document editor.
    setLayout('conversation'); setView('brief');
    await api.dismissHandoff(work.id, handoff.fileName).catch(() => undefined);
    setHandoffs(await api.listHandoffs(work.id).catch(() => []));
    setNotice(`${handoff.roleName} abierto con el pedido cargado. Revisalo antes de enviarlo.`);
  });
  const dismissHandoff = (handoff: HandoffRequest) => run(async () => {
    if (!work) return;
    await api.dismissHandoff(work.id, handoff.fileName);
    setHandoffs(await api.listHandoffs(work.id).catch(() => []));
  });
  const restartMember = (memberId: string) => run(async () => { await api.restartTeamMember(memberId); dropChat(memberId); if (work) await loadTeam(work.id); setNotice('Conversación nueva. El agente vuelve a leer el contexto del trabajo.'); await openMember(memberId); });
  /**
   * Changing the model restarts the runtime and resumes the conversation. The
   * notice says which of the two happened: claiming a history that did not
   * come back would be a lie the old terminal never told.
   */
  const setMemberModel = (memberId: string, model: string | null) => run(async () => {
    const result = await api.setTeamMemberModel(memberId, model);
    if (work) await loadTeam(work.id);
    const name = model ?? 'el modelo por defecto del CLI';
    if (!result.session) { setNotice(`Ahora usa ${name}. Se aplica cuando abras la conversación.`); return; }
    chatStore.forget(memberId);
    setChats(prev => ({ ...prev, [result.session!.id]: result.session! }));
    if (result.resumed) await chatStore.sync(result.session.id);
    setNotice(result.resumed ? `Ahora usa ${name}. La conversación sigue donde estaba.` : `Ahora usa ${name}. No se pudo retomar lo anterior: esta conversación empieza limpia.`);
  });
  const removeMember = (memberId: string) => run(async () => { await api.removeTeamMember(memberId); dropChat(memberId); if (work) { setSelectedMembers(prev => { const next = { ...prev }; if (next[work.id] === memberId) delete next[work.id]; return next; }); await loadTeam(work.id); } });
  const liveChatIds = new Set(Object.keys(chats));
  const workHasLiveChat = (workId: string) => Object.values(chats).some(c => c.workId === workId);
  const sessionWork = works.find(w => w.id === session?.workId);
  const activeTerminals = Object.values(sessions).filter(s => !endedSessions.has(s.id)).length, activeChats = liveChatIds.size;
  // The update notice follows the user into Ajustes: it is about the app, not about the view.
  /**
   * The raw CLI, moved out of the work on purpose.
   *
   * A terminal inside the workspace competed with the conversation and
   * promised something Latte does not keep: nothing typed there becomes a
   * document, a version or a decision. It stays as the way out when a
   * conversation will not start, and it lives in Settings, where an escape
   * hatch belongs.
   */
  const terminalConsole = <section className="terminal-console">
    <h3>Terminal · avanzado</h3>
    <p className="settings-lead">{work ? <>Tu CLI crudo, abierto en la carpeta de <strong>{work.title}</strong>. Nada de lo que pase acá se convierte en documento, versión ni decisión: es la salida para cuando una conversación no arranca, no la forma de trabajar.</> : 'Elegí un trabajo antes de abrir una terminal: se abre en la carpeta de ese trabajo.'}</p>
    {work && <><p className="agent-explanation">Tu CLI, con sus herramientas y su propia interfaz. Latte prepara el espacio y el contexto de este trabajo.</p><label className="field-label" htmlFor="provider">RUNTIME</label><select id="provider" value={provider} disabled={Boolean(session) || starting} onChange={e => setProvider(e.target.value as Provider)}>{(['opencode', 'claude', 'codex'] as Provider[]).map(p => <option key={p} value={p}>{p === 'opencode' ? 'OpenCode' : p === 'claude' ? 'Claude Code' : 'Codex'}{runtimes.find(r => r.provider === p)?.available ? ' · Detectado' : ''}</option>)}</select><p className="runtime-detail">{runtimes.find(r => r.provider === provider)?.detail ?? 'Comprobando disponibilidad…'}</p>
        <div className="terminal-stack">{Object.values(sessions).map(s => <div key={s.id} style={{ display: s.id === session?.id ? 'block' : 'none' }}><TerminalPane sessionId={s.id} onError={setError} /></div>)}</div>
        {session ? <><div className="session-heading"><span><i className={sessionEnded ? 'ended-dot' : 'live-dot'} />{session.provider} · {sessionWork?.title ?? 'Trabajo de la sesión'}</span><button aria-label="Detener agente" title="Detener agente" onClick={() => run(async () => { await api.stopAgent(session.id); setSession(null); })}><Square size={13} /></button></div><form className="prompt-form" onSubmit={e => { e.preventDefault(); if (!prompt.trim() || sessionEnded) return; void run(async () => { await api.writeAgent(session.id, prompt + '\r'); setPrompt(''); }); }}><textarea aria-label="Mensaje al agente" placeholder="¿Qué trabajamos ahora?" value={prompt} onChange={e => setPrompt(e.target.value)} /><div><small>{sessionEnded ? 'Sesión finalizada' : 'Se envía al CLI activo'}</small><button className="primary icon-button" disabled={!prompt.trim() || busy || sessionEnded} aria-label="Enviar mensaje"><ArrowUpRight size={18} /></button></div></form></> : <div className="agent-idle"><div className="agent-symbol"><TerminalSquare size={27} /></div><h3>Una terminal real<br />para tu CLI.</h3><p>Iniciá una sesión con tu CLI instalado. Sus permisos y autenticación siguen bajo tu control.</p><button className="primary" disabled={!work || starting || !runtimes.find(r => r.provider === provider)?.available} onClick={start}>{starting ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{starting ? 'Iniciando…' : 'Iniciar agente'}</button>{!isDesktop && <small className="preview-note">La vista web guarda en este navegador. Para ejecutar agentes, abrí Latte Desktop.</small>}</div>}</>}
  </section>;

  if (settings) return <><SettingsScreen terminal={terminalConsole} onProfileDirtyChange={setProfileDirty} controls={isDesktop ? <WindowControls /> : null} section={settings} onSection={setSettings} onClose={() => { setSettings(null); setError(''); setNotice(''); }} onChanged={() => { void refreshChatStatus(); void api.listRoles().then(setRoles).catch(e=>setError(displayError(e))); }} onNotice={setNotice} onError={setError} notice={notice} error={error} onDismiss={() => { setError(''); setNotice(''); }} /><UpdateBanner /></>;
  return <div className={'app-shell' + (railed ? ' railed' : '') + (focusChat ? ' conversation-focus' : '') + (dragging ? ' dragging' : '')} style={{ ['--agent-width' as string]: `${agentWidth}px` }}>
    <aside className="sidebar">
      <div className="wordmark"><span className="logo-mark" aria-hidden="true" />Latte<span className="alpha">ALPHA</span><button className="rail-toggle" aria-expanded={!railed} aria-label={railed ? 'Desplegar el menú' : 'Plegar el menú'} title={railed ? 'Desplegar el menú' : 'Plegar el menú'} onClick={() => setRailed(v => !v)}>{railed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
      <div className="brand-picker"><select aria-label="Marca activa" value={brand?.id ?? ''} onChange={e => { const b = brands.find(b => b.id === e.target.value); if (b) selectBrand(b); }}>{!brands.length && <option value="">Tu primera marca</option>}{brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><ChevronDown size={15} /></div>
      <button className="subtle sidebar-add" disabled={transitioning} onClick={() => { setName(''); setModal('brand'); }}><Plus size={14} /> Agregar marca</button>
      <div className="nav-label">MARCA</div>
      <nav><button disabled={!brand} title="Contexto" className={view === 'context' ? 'nav-active' : ''} onClick={() => setView('context')}><FileText size={18} />Contexto</button><button disabled={!brand} title="Memoria" className={view === 'memory' ? 'nav-active' : ''} onClick={openMemory}><Bookmark size={18} />Memoria</button></nav>
      <div className="sidebar-rule" /><div className="nav-label">TRABAJOS <span>{works.length.toString().padStart(2, '0')}</span></div>
      <nav className="work-nav">{works.map(w => <button key={w.id} title={w.title} className={work?.id === w.id && (view === 'brief' || view === 'decisions') ? 'work-active' : ''} onClick={() => selectWork(w)}><Folder size={17} /><span>{w.title}</span>{(workHasLiveChat(w.id) || sessions[w.id]) && <i className={sessions[w.id] && endedSessions.has(sessions[w.id].id) && !workHasLiveChat(w.id) ? 'ended-dot' : 'live-dot'} />}</button>)}{!works.length && <p className="sidebar-hint">Un espacio para cada idea que querés llevar adelante.</p>}</nav>
      <div className="sidebar-bottom"><button disabled={!brand || transitioning} title="Nuevo trabajo" onClick={() => { setName(''); setModal('work'); }}><Plus size={20} />Nuevo trabajo</button><div className="sidebar-rule" /><nav><button onClick={() => setSettings('agents')} title="Ajustes"><Settings2 size={17} />Ajustes</button></nav><div className="profile"><span className="avatar">G</span><div>Tu estudio<small>Local · Sin cuenta de Latte</small></div></div></div>
    </aside>
    <header className="topbar"><div className="breadcrumb">{brand?.name ?? 'Bienvenido a Latte'}<span>/</span><strong>{work?.title ?? 'Tu espacio de marketing'}</strong></div>{work && <div className="workspace-modes" role="group" aria-label="Vista del trabajo"><button aria-pressed={focusChat} onClick={() => { setLayout('conversation'); setView('brief'); }}><MessageSquare size={15} />Conversar</button><button aria-pressed={!focusChat} onClick={() => { setLayout('review'); setView('brief'); }}><FileText size={15} />Revisar</button></div>}<span className="local-badge"><i />{isDesktop ? 'Local' : 'Vista previa web'}</span>{isDesktop && <WindowControls />}</header>
    <main className="workspace" aria-hidden={focusChat} inert={focusChat}>
      <div className="tabs"><button className={view === 'brief' ? 'selected' : ''} onClick={() => setView('brief')}>Documentos <span>{documents.length}</span></button><button className={view === 'funnel' ? 'selected' : ''} onClick={() => setView('funnel')}>Embudo</button><button className={view === 'decisions' ? 'selected' : ''} onClick={() => setView('decisions')}>Decisiones <span>{decisions.length}</span></button><div className="tab-spacer" /></div>
      {(error || notice) && <div role={error ? 'alert' : 'status'} className={'message ' + (error ? 'error' : '')}><span>{error || notice}</span><button aria-label="Cerrar aviso" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></button></div>}
      {(view === 'brief' || view === 'funnel') && <DocumentsView funnel={view === 'funnel'} onView={setView} work={work} brandName={brand?.name ?? ''} documents={documents} selectedId={selectedDocId} onSelect={id => work && setSelectedDoc(prev => ({ ...prev, [work.id]: id }))} onDocumentsChanged={async () => { if (work) await loadDocuments(work.id); }} onWorkUpdated={onWorkUpdated} onDirtyChange={setDocumentDirty} onNotice={setNotice} onError={setError} onCreate={() => setModal('document')} onUseFolder={useFolder} hasBrand={Boolean(brand)} onStart={() => { setName(''); setModal(brand ? 'work' : 'brand'); }} untracked={untracked} onTrack={trackFile} editors={editors} busy={busy} />}
      {view === 'context' && <div className="document-scroll"><div className="document-kicker">EL PUNTO DE PARTIDA</div><h1>Una marca.<br />Un contexto compartido.</h1><p className="intro">Lo que el agente necesita saber: negocio, audiencia, tono, restricciones y decisiones vigentes. Se incorpora al iniciar cada sesión.</p><label className="field-label" htmlFor="brand-context">CONTEXTO DE {brand?.name}</label><textarea id="brand-context" className="context-editor" value={context} onChange={e => setContext(e.target.value)} placeholder="¿Qué ofrece la marca? ¿Para quién? ¿Qué no debemos asumir?" /><button className="primary" disabled={!contextDirty || busy} onClick={() => run(saveContext)}><Save size={16} />Guardar contexto</button><p className="footnote">Los cambios aplican a nuevas sesiones. No alteran retroactivamente el contexto de un agente en marcha.</p></div>}
      {view === 'decisions' && <div className="document-scroll"><div className="document-kicker">CRITERIO QUE PERMANECE</div><h1>No empezar<br />de cero otra vez.</h1><p className="intro">Registrá qué decidiste y por qué. Las decisiones pertenecen a este trabajo; no se convierten automáticamente en reglas de marca.</p>{work && <form className="decision-form" onSubmit={e => { e.preventDefault(); void run(async () => { if (!decision.trim()) return; await api.addDecision(work.id, decision.trim()); setDecisions(await api.listDecisions(work.id)); setDecision(''); }); }}><textarea aria-label="Nueva decisión" placeholder="Elegimos… porque…" value={decision} onChange={e => setDecision(e.target.value)} /><button className="primary" disabled={!decision.trim() || busy}><Plus size={15} />Registrar decisión</button></form>}<div className="decision-list">{decisions.map((d, i) => <div className="decision-card" key={d.id}><span className="decision-number">{String(i + 1).padStart(2, '0')}</span><div><p>{d.text}</p><small>{date(d.createdAt)}</small></div></div>)}{!decisions.length && <p className="footnote">Todavía no hay decisiones registradas.</p>}</div></div>}
      {view === 'memory' && <div className="document-scroll"><div className="document-kicker">MEMORIA DE MARCA · ENGRAM</div><h1>El trabajo sigue.<br />El contexto también.</h1><p className="intro">Conocimiento seleccionado, no una copia de cada conversación. Los recuerdos de esta marca se consultan por separado.</p><div className="memory-result"><ReactMarkdown remarkPlugins={[remarkGfm]}>{memory || 'Sin resultados.'}</ReactMarkdown></div><label className="field-label" htmlFor="memory-note">CONSERVAR UN APRENDIZAJE</label><textarea id="memory-note" className="context-editor short" value={memoryNote} onChange={e => setMemoryNote(e.target.value)} placeholder="Qué aprendimos, por qué importa y de dónde surge…" /><button className="primary" disabled={!memoryAvailable || !memoryNote.trim() || busy} onClick={() => run(async () => { const r = await api.saveMemory(brand!.id, memoryNote); if (!r.available) throw new Error(r.text); setMemoryNote(''); setNotice('Aprendizaje guardado en Engram'); openMemory(); })}><Bookmark size={15} />Guardar aprendizaje</button></div>}
      <div className="document-footer"><span><FileText size={13} />{work ? `${documents.length} documento${documents.length === 1 ? '' : 's'} en este trabajo` : 'Un espacio para tu criterio'}</span><span>{work ? date(work.updatedAt) : 'An Agent Marketing Platform'}</span></div>
    </main>
    <aside className="agent-panel">{focusChat && (error || notice) && <div role={error ? 'alert' : 'status'} className={'message ' + (error ? 'error' : '')}><span>{error || notice}</span><button aria-label="Cerrar aviso" onClick={() => { setError(''); setNotice(''); }}><X size={16} /></button></div>}<button type="button" className={'panel-resizer' + (dragging ? ' dragging' : '')} aria-label="Ajustar ancho del panel del agente" title="Arrastrá para cambiar el ancho" onPointerDown={startResize} />
      <TeamPanel work={work} team={team} chats={chats} selectedId={selectedMemberId} roles={roles} primaryLabel={primaryLabel} primaryDetail={primaryDetail} primaryReady={primaryReady} checking={checkingAgents} choices={runtimeChoices} busy={busy || startingChat} isDesktop={isDesktop} onSelect={selectMember} onAdd={addMember} onOpen={openMember} onPause={pauseMember} onFinish={finishMember} onRestart={restartMember} onRemove={removeMember} onModel={setMemberModel} handoffs={handoffs} onAcceptHandoff={acceptHandoff} onDismissHandoff={dismissHandoff} onSaveAsDocument={saveAnswerAsDocument} untracked={untracked.map(f => f.fileName)} onAdoptFile={fileName => void trackFile(fileName)} primaryRuntime={primaryRuntime} trustedFolder={trustedFolder} onTrustFolder={trustFolder} onProviders={() => setSettings('agents')} onRecheck={() => void refreshChatStatus()} onError={setError} />
      <details className="active-context">
        <summary><Bookmark size={12} />Contexto<span>{[brand?.context ? 'marca' : null, work ? 'trabajo' : null, decisions.length ? `${decisions.length} decisiones` : null].filter(Boolean).join(' · ') || 'sin contexto'}</span></summary>
        <div className="active-context-body">
          <span><FileText size={13} />{brand?.context ? 'Contexto de marca' : 'Marca sin contexto'}</span>
          <span><Folder size={13} />{work?.title ?? 'Sin trabajo seleccionado'}</span>
          <span><Bookmark size={13} />{decisions.length} decisiones registradas</span>
          <p className="agent-footnote">No se simulan respuestas de IA. Cada miembro del equipo usa {runtimeName} u otro runtime instalado en tu equipo; la terminal ejecuta tu CLI tal cual es.</p>
        </div>
      </details>
    </aside>
    <footer className="statusbar"><span><Circle size={11} />{isDesktop ? `Espacio local · ${activeChats} chats · ${activeTerminals} terminales` : 'Previsualización · localStorage'}</span><span>{busy ? 'Procesando…' : dirty || contextDirty ? 'Cambios sin guardar' : 'Todo guardado'}<Check size={13} /></span><span>Latte <span className="status-version">0.1 / ALPHA</span></span></footer>
    {(modal === 'brand' || modal === 'work') && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="modal"><div className="modal-head"><div><div className="document-kicker">TU ESTUDIO, CON ORDEN</div><h2 id="dialog-title">{modal === 'brand' ? 'Una nueva marca.' : 'Un nuevo trabajo.'}</h2></div><button className="modal-close" aria-label="Cerrar" onClick={() => setModal(null)}><X size={20} /></button></div><div className="modal-body"><form onSubmit={e => { e.preventDefault(); void create(); }}><label className="field-label" htmlFor="new-name">{modal === 'brand' ? 'NOMBRE DE LA MARCA' : 'TÍTULO DEL TRABAJO'}</label><input autoFocus id="new-name" maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder={modal === 'brand' ? 'Ej. Casa Oliva' : 'Ej. Investigación de audiencia'} /><p className="footnote">Podés empezar con lo que sabés e incorporar contexto después.</p><button className="primary" disabled={!name.trim() || busy}>Crear {modal === 'brand' ? 'marca' : 'trabajo'}<ArrowUpRight size={16} /></button></form></div></section></div>}
    {modal === 'document' && <NewDocumentDialog documents={documents} busy={busy} onCancel={() => setModal(null)} onCreate={createDocument} />}
    <UpdateBanner />
  </div>;
}
