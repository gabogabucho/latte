import { useEffect, useState } from 'react';
import { Check, CircleCheck, FolderCheck, FolderLock, LoaderCircle, MessageSquare, MessageSquarePlus, Pause, Play, Plug, Plus, Trash2, UserPlus, X } from 'lucide-react';
import type { AgentRole, ChatRuntime, ChatSession, HandoffRequest, TeamMember, TeamMemberOptions, TeamMemberStatus, Work } from '../shared/contracts';
import { chatStore } from './browser-api';
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
  onError: (message: string) => void;
  /** Turns an answer into a document of the work. */
  onSaveAsDocument?: (text: string) => void;
  /** Files the agent left in the folder that are not documents yet. */
  untracked: string[];
  onAdoptFile: (fileName: string) => void;
  /** The team may read and write inside this work folder without asking each time. */
  trustedFolder: boolean;
  onTrustFolder: (trusted: boolean) => void;
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
        {selected && <div className="team-tab-actions">
          {selectedLive && <button className="icon-button" aria-label="Pausar conversación" title="Pausar: la conversación queda guardada y se puede reanudar" disabled={busy} onClick={() => void props.onPause(selected.id)}><Pause size={13} /></button>}
          {selectedStatus !== 'ended' && <button className="icon-button" aria-label="Marcar como finalizado" title="Finalizar: cierra la conversación y la marca como terminada" disabled={busy} onClick={() => void props.onFinish(selected.id)}><CircleCheck size={13} /></button>}
          <button className="icon-button" aria-label="Conversación nueva" title="Conversación nueva: descarta esta conversación y empieza otra con el mismo rol" disabled={busy} onClick={() => { if (window.confirm(`¿Empezar una conversación nueva con ${selected.roleName}? La actual se descarta; ${selected.roleName} sigue en el equipo y los documentos no se tocan.`)) void props.onRestart(selected.id); }}><MessageSquarePlus size={13} /></button>
          <button className="icon-button" aria-label="Quitar del equipo" title="Quitar del equipo" disabled={busy} onClick={() => { if (window.confirm(`¿Quitar a ${selected.roleName} del equipo? Su conversación deja de estar disponible desde Latte.`)) void props.onRemove(selected.id); }}><Trash2 size={13} /></button>
        </div>}
      </div>
      {(props.primaryRuntime === 'claude' || team.some(m => m.runtime === 'claude')) && <FolderTrust trusted={props.trustedFolder} busy={busy} onChange={props.onTrustFolder} />}
    </>}
    {firstTeam && <RolePicker roles={roles} choices={props.choices} primaryLabel={props.primaryLabel} primaryDetail={props.primaryDetail} primaryReady={props.primaryReady} busy={busy} isDesktop={isDesktop} canCancel={team.length > 0} onCancel={() => setAdding(false)} onProviders={props.onProviders} onRecheck={props.onRecheck} onAdd={async (roleId, options) => { await props.onAdd(roleId, options); setAdding(false); }} />}
    {adding && !firstTeam && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setAdding(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="add-member-title" className="modal">
        <div className="modal-head"><div><div className="document-kicker">TU ESTUDIO, CON ORDEN</div><h2 id="add-member-title">Un miembro nuevo.</h2></div><button className="modal-close" aria-label="Cerrar" onClick={() => setAdding(false)}><X size={20} /></button></div>
        <div className="modal-body"><RolePicker roles={roles} choices={props.choices} primaryLabel={props.primaryLabel} primaryDetail={props.primaryDetail} primaryReady={props.primaryReady} busy={busy} isDesktop={isDesktop} canCancel={false} onCancel={() => setAdding(false)} onProviders={props.onProviders} onRecheck={props.onRecheck} onAdd={async (roleId, options) => { await props.onAdd(roleId, options); setAdding(false); }} /></div>
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
function FolderTrust({ trusted, busy, onChange }: { trusted: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return <details className={'folder-trust' + (trusted ? ' granted' : '')}>
    <summary>
      {trusted ? <FolderCheck size={13} /> : <FolderLock size={13} />}
      <span>{trusted ? 'Escriben en esta carpeta sin preguntar' : 'Piden permiso por cada archivo'}</span>
    </summary>
    <p>{trusted
      ? 'Leen y escriben en la carpeta de este trabajo sin preguntar. Fuera de la carpeta, y para comandos, web o herramientas MCP, siguen preguntando.'
      : 'Claude Code pide permiso por cada archivo que escribe: son tres o cuatro cortes por tarea. Podés permitirlo de una vez, solo para esta carpeta.'}</p>
    <p className="folder-trust-note">Aplica a las conversaciones que abras desde ahora.</p>
    <button className="subtle" disabled={busy} onClick={() => onChange(!trusted)}>{trusted ? 'Volver a preguntar siempre' : 'Permitir en esta carpeta'}</button>
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

function RolePicker({ roles, choices, primaryLabel, primaryDetail, primaryReady, busy, isDesktop, canCancel, onCancel, onAdd, onProviders, onRecheck }: { roles: AgentRole[]; choices: RuntimeChoice[]; primaryLabel: string; primaryDetail: string; primaryReady: boolean; busy: boolean; isDesktop: boolean; canCancel: boolean; onCancel: () => void; onAdd: (roleId: string, options: TeamMemberOptions | null) => Promise<void>; onProviders: () => void; onRecheck: () => void }) {
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
    <select id="member-runtime" value={choice} disabled={busy || opening} onChange={e => setChoice(e.target.value)}>
      <option value="primary">Agente principal · {primaryLabel}</option>
      {choices.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
    </select>
    {choice === 'primary' && <small className="runtime-detail">{primaryDetail}</small>}
    <div className="chat-card-actions">
      <button className="primary" disabled={busy || opening || !ready || !isDesktop} onClick={() => void add()}>{opening ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}{opening ? 'Abriendo…' : 'Abrir conversación'}</button>
      {isDesktop && <button className="subtle" onClick={onProviders}><Plug size={13} />{primaryReady ? 'Cambiar agente principal' : 'Conectar un proveedor'}</button>}
      {isDesktop && !primaryReady && <button className="subtle" onClick={onRecheck}>Volver a comprobar</button>}
    </div>
    {!isDesktop && <small className="preview-note">La vista web guarda en este navegador. Para conversar con agentes, abrí Latte Desktop.</small>}
  </div>;
}
