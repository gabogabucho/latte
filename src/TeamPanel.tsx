import { useEffect, useState } from 'react';
import { Check, CircleCheck, FolderCheck, FolderLock, LoaderCircle, MessageSquare, MessageSquarePlus, Pause, Play, Plug, Plus, Settings2, Trash2, UserPlus, X, Zap } from 'lucide-react';
import type { AgentModelList, AgentRole, WorkPermissionMode, ChatRuntime, ChatSession, HandoffRequest, TeamMember, TeamMemberOptions, TeamMemberStatus, Work } from '../shared/contracts';
import { api, chatStore } from './browser-api';
import { ChatPane } from './ChatPane';
import { useChatState } from './chat-store';

/** A runtime the user can pick for a new member instead of the primary agent. */
export interface RuntimeChoice { key: string; label: string; runtime: ChatRuntime; accountId: string | null }

export interface TeamPanelProps {
  work: Work | null;
  team: TeamMember[];
  /** Live sessions by chat id (= member id). */
  chats: Record<string, ChatSession>;
  selectedId: string | null;
  roles: AgentRole[];
  primaryLabel: string;
  primaryDetail: string;
  primaryReady: boolean;
  /** The runtimes are still being detected: the list of agents is not empty, it is unknown. */
  checking: boolean;
  /** Runtime the primary agent uses; the folder grant only changes anything for Claude. */
  primaryRuntime: ChatRuntime;
  choices: RuntimeChoice[];
  busy: boolean;
  isDesktop: boolean;
  onSelect: (memberId: string) => void;
  onAdd: (roleId: string, options: TeamMemberOptions | null) => Promise<void>;
  onOpen: (memberId: string) => Promise<void>;
  onPause: (memberId: string) => Promise<void>;
  onFinish: (memberId: string) => Promise<void>;
  onRestart: (memberId: string) => Promise<void>;
  /** Roles one agent asked for; the human decides whether any conversation opens. */
  handoffs: HandoffRequest[];
  onAcceptHandoff: (handoff: HandoffRequest) => Promise<void>;
  onDismissHandoff: (handoff: HandoffRequest) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
  onProviders: () => void;
  onRecheck: () => void;
  /** Changes the model of one conversation; the runtime restarts and resumes underneath. */
  onModel: (memberId: string, model: string | null) => void;
  onError: (message: string) => void;
  /** Turns an answer into a document of the work. */
  onSaveAsDocument?: (text: string) => void;
  /** Files the agent left in the folder that are not documents yet. */
  untracked: string[];
  onAdoptFile: (fileName: string) => void;
  /** How much this work's team may do without asking. */
  permissions: WorkPermissionMode;
  onPermissions: (mode: WorkPermissionMode) => void;
}

const RUNTIME_SHORT: Record<ChatRuntime, string> = { opencode: 'OpenCode', claude: 'Claude', codex: 'Codex' };

/**
 * The work's team: one row per role opened in this work, the selected one's
 * conversation underneath. Status is live for open members (from the chat
 * store) and persisted for the rest (paused / finished).
 */
export function TeamPanel(props: TeamPanelProps) {
  const { work, team, chats, selectedId, roles, busy, isDesktop } = props;
  const [adding, setAdding] = useState(false);
  useEffect(() => { setAdding(false); }, [work?.id]);
  const selected = team.find(m => m.id === selectedId) ?? null;
  const liveChat = selected ? chats[selected.id] ?? null : null;
  const selectedState = useChatState(chatStore, liveChat?.id ?? null);
  const selectedLive = Boolean(liveChat) && !selectedState.closed;
  const selectedStatus: TeamMemberStatus = selectedLive ? (selectedState.status === 'idle' ? 'idle' : 'working') : selected?.status === 'ended' ? 'ended' : 'paused';
  // The first team is the empty state itself; after that, adding is a dialog.
  const firstTeam = team.length === 0 && Boolean(work);
  const showPicker = adding || firstTeam;

  return <div className="team">
    {work && props.handoffs.map(handoff => <div key={handoff.fileName} className="doc-banner handoff" role="status">
      <UserPlus size={14} />
      <span>Un agente pide que <strong>{handoff.roleName}</strong> vea esto: <em>{handoff.request.split(/\r?\n/)[0].slice(0, 140)}</em>{handoff.known ? '' : ' — ese rol no existe en Latte.'}</span>
      {handoff.known && <button className="primary" disabled={busy} onClick={() => void props.onAcceptHandoff(handoff)}>Abrir con el pedido</button>}
      <button disabled={busy} onClick={() => void props.onDismissHandoff(handoff)}>Descartar</button>
    </div>)}
    {work && team.length > 0 && <>
      <div className="team-tabs" role="tablist" aria-label="Miembros del equipo">
        <div className="team-tab-strip">
          {team.map(member => <MemberTab key={member.id} member={member} chat={chats[member.id] ?? null} selected={member.id === selectedId} busy={busy} onSelect={() => props.onSelect(member.id)} />)}
        </div>
        <button className="team-tab-add" aria-label="Sumar un rol al equipo" title="Sumar un rol al equipo" disabled={busy || !isDesktop} onClick={() => setAdding(true)}><UserPlus size={15} /></button>
        <button className="team-tab-add" aria-label="Proveedores de IA" title="Agentes y proveedores" onClick={props.onProviders}><Settings2 size={15} /></button>
        {selected && <div className="team-tab-actions">
          <ModelPicker member={selected} busy={busy} onModel={props.onModel} />
          {selectedLive && <button className="icon-button" aria-label="Pausar conversación" title="Pausar: la conversación queda guardada y se puede reanudar" disabled={busy} onClick={() => void props.onPause(selected.id)}><Pause size={13} /></button>}
          {selectedStatus !== 'ended' && <button className="icon-button" aria-label="Marcar como finalizado" title="Finalizar: cierra la conversación y la marca como terminada" disabled={busy} onClick={() => void props.onFinish(selected.id)}><CircleCheck size={13} /></button>}
          <button className="icon-button" aria-label="Conversación nueva" title="Conversación nueva: descarta esta conversación y empieza otra con el mismo rol" disabled={busy} onClick={() => { if (window.confirm(`¿Empezar una conversación nueva con ${selected.roleName}? La actual se descarta; ${selected.roleName} sigue en el equipo y los documentos no se tocan.`)) void props.onRestart(selected.id); }}><MessageSquarePlus size={13} /></button>
          <button className="icon-button" aria-label="Quitar del equipo" title="Quitar del equipo" disabled={busy} onClick={() => { if (window.confirm(`¿Quitar a ${selected.roleName} del equipo? Su conversación deja de estar disponible desde Latte.`)) void props.onRemove(selected.id); }}><Trash2 size={13} /></button>
        </div>}
      </div>
      {<WorkPermissions mode={props.permissions} busy={busy} hasClaude={props.primaryRuntime === 'claude' || team.some(m => m.runtime === 'claude')} onChange={props.onPermissions} />}
    </>}
    {firstTeam && <RolePicker roles={roles} choices={props.choices} primaryLabel={props.primaryLabel} primaryDetail={props.primaryDetail} primaryReady={props.primaryReady} checking={props.checking} busy={busy} isDesktop={isDesktop} canCancel={team.length > 0} onCancel={() => setAdding(false)} onProviders={props.onProviders} onRecheck={props.onRecheck} onAdd={async (roleId, options) => { await props.onAdd(roleId, options); setAdding(false); }} />}
    {adding && !firstTeam && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setAdding(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="add-member-title" className="modal">
        <div className="modal-head"><div><div className="document-kicker">TU ESTUDIO, CON ORDEN</div><h2 id="add-member-title">Un miembro nuevo.</h2></div><button className="modal-close" aria-label="Cerrar" onClick={() => setAdding(false)}><X size={20} /></button></div>
        <div className="modal-body"><RolePicker roles={roles} choices={props.choices} primaryLabel={props.primaryLabel} primaryDetail={props.primaryDetail} primaryReady={props.primaryReady} checking={props.checking} busy={busy} isDesktop={isDesktop} canCancel={false} onCancel={() => setAdding(false)} onProviders={props.onProviders} onRecheck={props.onRecheck} onAdd={async (roleId, options) => { await props.onAdd(roleId, options); setAdding(false); }} /></div>
      </section></div>}
    {!work && <div className="agent-idle"><div className="agent-symbol"><MessageSquare size={27} /></div><h3>Un equipo listo<br />para trabajar.</h3><p className="footnote">Elegí o creá un trabajo para armar su equipo.</p></div>}
    {!showPicker && selected && (liveChat ? <ChatPane key={liveChat.id} session={liveChat} onStop={() => void props.onPause(selected.id)} onError={props.onError} onSaveAsDocument={props.onSaveAsDocument} untracked={props.untracked} onAdoptFile={props.onAdoptFile} /> : <ResumeCard member={selected} busy={busy} onOpen={() => props.onOpen(selected.id)} onRestart={() => props.onRestart(selected.id)} onRemove={() => props.onRemove(selected.id)} />)}
    {!showPicker && !selected && team.length > 0 && <p className="chat-empty">Elegí un miembro del equipo para ver su conversación.</p>}
  </div>;
}

/**
 * One grant instead of a prompt per file.
 *
 * Every claim here was measured against a real Claude Code, not assumed: with
 * the folder patterns a write inside the work folder stops asking, a read or
 * write one level up still asks, and every other tool keeps asking. Codex
 * already runs with its workspace writable, so the row only shows up when the
 * team has a member this actually changes something for.
 *
 * It stays one line tall on purpose: the conversation below needs the height
 * more than this does.
 */
const PERMISSION_LABEL: Record<WorkPermissionMode, string> = {
  ask: 'Piden permiso por cada cosa',
  folder: 'Escriben en esta carpeta sin preguntar',
  auto: 'Automático: Latte aprueba por vos',
};

/**
 * How much this work's team may do without stopping to ask.
 *
 * Three levels, because the middle one is the honest default for writing
 * documents and the last one is a real handover of judgement: in `auto` Latte
 * answers every request itself. It answers *once* each time, never "always",
 * so nothing is written into a runtime's own permission file and going back to
 * asking takes effect on the very next request.
 */
function WorkPermissions({ mode, busy, hasClaude, onChange }: { mode: WorkPermissionMode; busy: boolean; hasClaude: boolean; onChange: (mode: WorkPermissionMode) => void }) {
  const pick = (next: WorkPermissionMode) => {
    if (next === mode) return;
    const warning = [
      'Modo automático para este trabajo.',
      'Latte va a aprobar cada pedido del agente sin preguntarte: archivos, comandos, web y herramientas.',
      hasClaude ? 'Claude Code no tiene sandbox: un comando puede tocar cualquier archivo al que tenga permiso tu usuario, dentro o fuera de la carpeta del trabajo. Codex sí queda limitado a la carpeta.' : '',
      'Se apaga cuando quieras y el pedido siguiente vuelve a preguntarte. ¿Activar?',
    ].filter(Boolean).join('\n\n');
    if (next === 'auto' && !window.confirm(warning)) return;
    onChange(next);
  };
  return <details className={'folder-trust mode-' + mode}>
    <summary>
      {mode === 'ask' ? <FolderLock size={13} /> : mode === 'folder' ? <FolderCheck size={13} /> : <Zap size={13} />}
      <span>{PERMISSION_LABEL[mode]}</span>
    </summary>
    <div className="permission-modes" role="radiogroup" aria-label="Permisos de este trabajo">
      {(['ask', 'folder', 'auto'] as WorkPermissionMode[]).map(value => <button
        key={value}
        role="radio"
        aria-checked={mode === value}
        className={mode === value ? 'selected' : ''}
        disabled={busy}
        onClick={() => pick(value)}
      >
        <strong>{PERMISSION_LABEL[value]}</strong>
        <small>{value === 'ask'
          ? 'Cada archivo y cada comando te pregunta. Es el modo seguro y el más lento.'
          : value === 'folder'
            ? 'Leen y escriben en la carpeta de este trabajo sin preguntar. Comandos, web y herramientas siguen preguntando. Aplica a las conversaciones que abras desde ahora.'
            : 'Latte responde que sí a todo lo que pida el agente de este trabajo, sin preguntarte. Responde una vez por pedido: no le deja permisos guardados a ningún runtime, y apagarlo vuelve a preguntar en el pedido siguiente.'}</small>
      </button>)}
    </div>
    {mode === 'auto' && hasClaude && <p className="permission-warning">Claude Code no tiene sandbox: lo que apruebe Latte puede tocar cualquier archivo al que tenga permiso tu usuario. Codex queda limitado a la carpeta del trabajo.</p>}
  </details>;
}

function MemberTab({ member, chat, selected, busy, onSelect }: { member: TeamMember; chat: ChatSession | null; selected: boolean; busy: boolean; onSelect: () => void }) {
  const state = useChatState(chatStore, chat ? chat.id : null);
  const live = Boolean(chat) && !state.closed;
  const status: TeamMemberStatus = live ? (state.status === 'idle' ? 'idle' : 'working') : member.status === 'ended' ? 'ended' : 'paused';
  const attention = live && (state.permissions.length > 0 || state.questions.length > 0);
  return <button role="tab" aria-selected={selected} className={'team-tab status-' + status + (attention ? ' attention' : '')} disabled={busy} onClick={onSelect} title={member.roleName + ' · ' + RUNTIME_SHORT[member.runtime] + ' · ' + statusLabel(status, attention)}>
    <span className="team-avatar" data-role={member.roleId} aria-hidden="true">{member.initial}</span>
    <span className="team-tab-name">{member.roleName}</span>
    <i className="team-tab-dot" aria-hidden="true" />
    <span className="visually-hidden">{statusLabel(status, attention)}</span>
  </button>;
}

function statusLabel(status: TeamMemberStatus, attention: boolean) {
  if (attention) return <><i className="busy-dot" />Te necesita</>;
  switch (status) {
    case 'working': return <><LoaderCircle className="spin" size={12} />Trabajando</>;
    case 'idle': return <><i className="live-dot" />Activo</>;
    case 'ended': return <>Finalizó<CircleCheck size={13} /></>;
    default: return <>En pausa<Pause size={12} /></>;
  }
}

function ResumeCard({ member, busy, onOpen, onRestart, onRemove }: { member: TeamMember; busy: boolean; onOpen: () => Promise<void>; onRestart: () => Promise<void>; onRemove: () => Promise<void> }) {
  const [opening, setOpening] = useState(false);
  const open = async () => { setOpening(true); try { await onOpen(); } finally { setOpening(false); } };
  return <div className="agent-idle team-resume">
    <span className="team-avatar large" data-role={member.roleId} aria-hidden="true">{member.initial}</span>
    <h3>{member.roleName}<br /><small>{member.label}</small></h3>
    <p>{member.status === 'ended' ? 'Este miembro terminó su trabajo. Podés reabrir la conversación donde quedó.' : 'La conversación está en pausa. Al reanudarla, el agente vuelve a leer el contexto actual del trabajo.'}</p>
    <button className="primary" disabled={busy || opening} onClick={() => void open()}>{opening ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}{opening ? 'Abriendo…' : member.status === 'ended' ? 'Reabrir conversación' : 'Reanudar conversación'}</button>
    <button className="subtle" disabled={busy || opening} onClick={() => { if (window.confirm(`¿Empezar una conversación nueva con ${member.roleName}? La actual se descarta; ${member.roleName} sigue en el equipo y los documentos no se tocan.`)) void onRestart(); }}><MessageSquarePlus size={13} />Conversación nueva</button>
    <button className="subtle" disabled={busy || opening} onClick={() => { if (window.confirm(`¿Quitar a ${member.roleName} del equipo?`)) void onRemove(); }}><Trash2 size={13} />Quitar del equipo</button>
  </div>;
}

function RolePicker({ roles, choices, primaryLabel, primaryDetail, primaryReady, checking, busy, isDesktop, canCancel, onCancel, onAdd, onProviders, onRecheck }: { roles: AgentRole[]; choices: RuntimeChoice[]; primaryLabel: string; primaryDetail: string; primaryReady: boolean; checking: boolean; busy: boolean; isDesktop: boolean; canCancel: boolean; onCancel: () => void; onAdd: (roleId: string, options: TeamMemberOptions | null) => Promise<void>; onProviders: () => void; onRecheck: () => void }) {
  const [roleId, setRoleId] = useState(roles[0]?.id ?? 'assistant');
  const [choice, setChoice] = useState('primary');
  const [opening, setOpening] = useState(false);
  const picked = choices.find(c => c.key === choice) ?? null;
  const ready = choice === 'primary' ? primaryReady : Boolean(picked);
  const add = async () => {
    if (!ready || opening) return;
    setOpening(true);
    try { await onAdd(roleId, picked ? { runtime: picked.runtime, accountId: picked.accountId, model: null } : null); } finally { setOpening(false); }
  };
  return <div className="role-picker">
    <div className="role-picker-head"><span className="field-label">{canCancel ? 'SUMAR UN ROL' : 'ARMÁ TU EQUIPO'}</span>{canCancel && <button className="icon-button" aria-label="Cancelar" onClick={onCancel}><X size={15} /></button>}</div>
    <p className="agent-explanation">Cada rol abre su propia conversación con una personalidad preestablecida. Todos comparten el contexto de marca, el brief y las decisiones de este trabajo.</p>
    <div className="role-list" role="radiogroup" aria-label="Rol">
      {roles.map(role => <button key={role.id} role="radio" aria-checked={roleId === role.id} className={'role-card' + (roleId === role.id ? ' selected' : '')} onClick={() => setRoleId(role.id)}><span className="team-avatar" data-role={role.id} aria-hidden="true">{role.initial}</span><span><strong>{role.name}</strong><small>{role.summary}</small></span>{roleId === role.id && <Check size={14} />}</button>)}
    </div>
    <label className="field-label" htmlFor="member-runtime">CON QUÉ AGENTE</label>
    {/*
      Detecting the runtimes means running their CLIs, and that costs seconds.
      Until it answers, the list is not empty: it is unknown. Saying so beats a
      picker with one option that looks broken.
    */}
    <select id="member-runtime" value={choice} disabled={busy || opening || checking} onChange={e => setChoice(e.target.value)}>
      {checking
        ? <option value="primary">Buscando los agentes instalados…</option>
        : <>
          <option value="primary">Agente principal · {primaryLabel}</option>
          {choices.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </>}
    </select>
    {choice === 'primary' && <small className="runtime-detail">{checking ? 'Latte le está preguntando a cada CLI si está instalado y con sesión iniciada. Tarda unos segundos la primera vez.' : primaryDetail}</small>}
    <div className="chat-card-actions">
      <button className="primary" disabled={busy || opening || checking || !ready || !isDesktop} onClick={() => void add()}>{opening || checking ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{opening ? 'Abriendo…' : checking ? 'Buscando agentes…' : 'Abrir conversación'}</button>
      {isDesktop && !checking && <button className="subtle" onClick={onProviders}><Plug size={13} />{primaryReady ? 'Cambiar agente principal' : 'Conectar un proveedor'}</button>}
      {isDesktop && !checking && !primaryReady && <button className="subtle" onClick={onRecheck}>Volver a comprobar</button>}
    </div>
    {!isDesktop && <small className="preview-note">La vista web guarda en este navegador. Para conversar con agentes, abrí Latte Desktop.</small>}
  </div>;
}


/**
 * The model this conversation runs on, changed without leaving it.
 *
 * Neither CLI swaps a model in place, so Latte restarts the runtime and
 * resumes the same conversation. The list is the runtime's own catalog where
 * there is one; OpenCode has 155 models behind a provider, which is a Settings
 * decision and not a control to squeeze next to a chat, so there it only
 * reports what is in use.
 */
function ModelPicker({ member, busy, onModel }: { member: TeamMember; busy: boolean; onModel: (memberId: string, model: string | null) => void }) {
  const [list, setList] = useState<AgentModelList | null>(null);
  useEffect(() => {
    let live = true;
    setList(null);
    // OpenCode already publishes what it has configured; the subscription
    // runtimes are asked one by one, and answer a catalog or an honest
    // "this is what Latte knows".
    const ask = member.runtime === 'opencode'
      ? api.chatStatus().then((status): AgentModelList => ({
        source: 'catalog',
        detail: `Modelos configurados en OpenCode${status.defaultModel ? ` · por defecto ${status.defaultModel}` : ''}.`,
        models: status.models.map(id => ({ id, label: id, description: '', isDefault: id === status.defaultModel })),
      }))
      : api.listAccountModels(member.runtime, member.accountId ?? 'system');
    void ask.then(value => { if (live) setList(value); }).catch(() => undefined);
    return () => { live = false; };
  }, [member.runtime, member.accountId]);

  const models = list?.models ?? [];
  const current = member.model ?? '';
  // OpenCode ids read `provider/model`; grouping by provider keeps a long list navigable.
  const groups = new Map<string, typeof models>();
  for (const model of models) {
    const slash = model.id.indexOf('/');
    const group = slash > 0 ? model.id.slice(0, slash) : '';
    groups.set(group, [...(groups.get(group) ?? []), model]);
  }
  const grouped = groups.size > 1 || (groups.size === 1 && !groups.has(''));
  const option = (m: AgentModelList['models'][number]) => <option key={m.id} value={m.id}>{m.label}{m.isDefault ? ' · por defecto' : ''}</option>;

  return <select
    className="team-model"
    aria-label={`Modelo de ${member.roleName}`}
    title={list ? `${list.detail} Cambiarlo reinicia el runtime y retoma esta conversación.` : 'Buscando los modelos de esta conversación…'}
    value={current}
    disabled={busy || !list}
    onChange={e => onModel(member.id, e.target.value || null)}
  >
    <option value="">{list ? 'Modelo por defecto' : 'Buscando modelos…'}</option>
    {current !== '' && !models.some(m => m.id === current) && <option value={current}>{current}</option>}
    {grouped
      ? [...groups.entries()].map(([group, items]) => group ? <optgroup key={group} label={group}>{items.map(option)}</optgroup> : items.map(option))
      : models.map(option)}
  </select>;
}
