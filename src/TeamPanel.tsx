import { useState } from 'react';
import { Check, CircleCheck, LoaderCircle, MessageSquare, Pause, Play, Plug, Plus, Trash2, UserPlus, X } from 'lucide-react';
import type { AgentRole, ChatRuntime, ChatSession, TeamMember, TeamMemberOptions, TeamMemberStatus, Work } from '../shared/contracts';
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
  choices: RuntimeChoice[];
  busy: boolean;
  isDesktop: boolean;
  onSelect: (memberId: string) => void;
  onAdd: (roleId: string, options: TeamMemberOptions | null) => Promise<void>;
  onOpen: (memberId: string) => Promise<void>;
  onPause: (memberId: string) => Promise<void>;
  onFinish: (memberId: string) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
  onProviders: () => void;
  onRecheck: () => void;
  onError: (message: string) => void;
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
  const selected = team.find(m => m.id === selectedId) ?? null;
  const liveChat = selected ? chats[selected.id] ?? null : null;
  const showPicker = adding || (team.length === 0 && Boolean(work));

  return <div className="team">
    {work && team.length > 0 && <div className="team-roster" role="listbox" aria-label="Miembros del equipo">
      {team.map(member => <MemberRow key={member.id} member={member} chat={chats[member.id] ?? null} selected={member.id === selectedId} busy={busy} onSelect={() => props.onSelect(member.id)} onPause={() => props.onPause(member.id)} onFinish={() => props.onFinish(member.id)} onRemove={() => props.onRemove(member.id)} />)}
      {!adding && <button className="team-add" disabled={busy || !isDesktop} onClick={() => setAdding(true)}><UserPlus size={15} />Sumar un rol al equipo</button>}
    </div>}
    {showPicker && <RolePicker roles={roles} choices={props.choices} primaryLabel={props.primaryLabel} primaryDetail={props.primaryDetail} primaryReady={props.primaryReady} busy={busy} isDesktop={isDesktop} canCancel={team.length > 0} onCancel={() => setAdding(false)} onProviders={props.onProviders} onRecheck={props.onRecheck} onAdd={async (roleId, options) => { await props.onAdd(roleId, options); setAdding(false); }} />}
    {!work && <div className="agent-idle"><div className="agent-symbol"><MessageSquare size={27} /></div><h3>Un equipo listo<br />para trabajar.</h3><p className="footnote">Elegí o creá un trabajo para armar su equipo.</p></div>}
    {!showPicker && selected && (liveChat ? <ChatPane key={liveChat.id} session={liveChat} onStop={() => void props.onPause(selected.id)} onError={props.onError} /> : <ResumeCard member={selected} busy={busy} onOpen={() => props.onOpen(selected.id)} onRemove={() => props.onRemove(selected.id)} />)}
    {!showPicker && !selected && team.length > 0 && <p className="chat-empty">Elegí un miembro del equipo para ver su conversación.</p>}
  </div>;
}

function MemberRow({ member, chat, selected, busy, onSelect, onPause, onFinish, onRemove }: { member: TeamMember; chat: ChatSession | null; selected: boolean; busy: boolean; onSelect: () => void; onPause: () => Promise<void>; onFinish: () => Promise<void>; onRemove: () => Promise<void> }) {
  const state = useChatState(chatStore, chat ? chat.id : null);
  const live = Boolean(chat) && !state.closed;
  const status: TeamMemberStatus = live ? (state.status === 'idle' ? 'idle' : 'working') : member.status === 'ended' ? 'ended' : 'paused';
  const attention = live && (state.permissions.length > 0 || state.questions.length > 0);
  return <div className={'team-member' + (selected ? ' selected' : '') + ' status-' + status} role="option" aria-selected={selected}>
    <button className="team-member-main" onClick={onSelect} title={member.label}>
      <span className="team-avatar" aria-hidden="true">{member.initial}</span>
      <span className="team-member-name"><strong>{member.roleName}</strong><span className="team-sep">/</span>{RUNTIME_SHORT[member.runtime]}</span>
      <span className="team-member-status">{statusLabel(status, attention)}</span>
    </button>
    {selected && <div className="team-member-actions">
      {live && <button className="icon-button" aria-label="Pausar conversación" title="Pausar: la conversación queda guardada y se puede reanudar" disabled={busy} onClick={() => void onPause()}><Pause size={13} /></button>}
      {status !== 'ended' && <button className="icon-button" aria-label="Marcar como finalizado" title="Finalizar: cierra la conversación y la marca como terminada" disabled={busy} onClick={() => void onFinish()}><CircleCheck size={13} /></button>}
      <button className="icon-button" aria-label="Quitar del equipo" title="Quitar del equipo" disabled={busy} onClick={() => { if (window.confirm(`¿Quitar a ${member.roleName} del equipo? Su conversación deja de estar disponible desde Latte.`)) void onRemove(); }}><Trash2 size={13} /></button>
    </div>}
  </div>;
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

function ResumeCard({ member, busy, onOpen, onRemove }: { member: TeamMember; busy: boolean; onOpen: () => Promise<void>; onRemove: () => Promise<void> }) {
  const [opening, setOpening] = useState(false);
  const open = async () => { setOpening(true); try { await onOpen(); } finally { setOpening(false); } };
  return <div className="agent-idle team-resume">
    <span className="team-avatar large" aria-hidden="true">{member.initial}</span>
    <h3>{member.roleName}<br /><small>{member.label}</small></h3>
    <p>{member.status === 'ended' ? 'Este miembro terminó su trabajo. Podés reabrir la conversación donde quedó.' : 'La conversación está en pausa. Al reanudarla, el agente vuelve a leer el contexto actual del trabajo.'}</p>
    <button className="primary" disabled={busy || opening} onClick={() => void open()}>{opening ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}{opening ? 'Abriendo…' : member.status === 'ended' ? 'Reabrir conversación' : 'Reanudar conversación'}</button>
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
      {roles.map(role => <button key={role.id} role="radio" aria-checked={roleId === role.id} className={'role-card' + (roleId === role.id ? ' selected' : '')} onClick={() => setRoleId(role.id)}><span className="team-avatar" aria-hidden="true">{role.initial}</span><span><strong>{role.name}</strong><small>{role.summary}</small></span>{roleId === role.id && <Check size={14} />}</button>)}
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
