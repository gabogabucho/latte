import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUpRight, Check, ChevronRight, CircleAlert, FilePlus, LoaderCircle, ShieldQuestion, Square, Wrench, X } from 'lucide-react';
import type { ChatMessage, ChatPart, ChatPermission, ChatQuestion, ChatSession, ChatToolStatus } from '../shared/contracts';
import { api, chatStore } from './browser-api';
import { useChatState } from './chat-store';
import { friendlyTool } from './tool-names';

const displayError = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ChatPane({ session, onStop, onError, onSaveAsDocument }: { session: ChatSession; onStop: () => void; onError: (error: string) => void; onSaveAsDocument?: (text: string) => void }) {
  const state = useChatState(chatStore, session.id);
  const draft = state.draft;
  const setDraft = (text: string) => chatStore.setDraft(session.id, text);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const busy = state.status === 'busy' || state.status === 'retry';

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.permissions.length, state.questions.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || state.closed) return;
    setSending(true);
    try {
      await api.sendChat(session.id, text);
      setDraft('');
    } catch (e) {
      onError(displayError(e));
    } finally {
      setSending(false);
    }
  };

  const abort = () => api.abortChat(session.id).catch(e => onError(displayError(e)));

  return <div className="chat-pane">
    <div className="session-heading">
      <span title={`${session.roleName} · ${session.label}`}><i className={'role-dot ' + (state.closed ? 'ended' : busy ? 'busy' : '')} data-role={session.roleId} /><strong>{session.roleName}</strong><span className="chat-heading-runtime">{session.label}</span>{session.resumed ? ' · reanudado' : ''}</span>
      <div className="chat-heading-actions">
        {busy && <button aria-label="Detener respuesta" title="Detener respuesta" onClick={abort}><Square size={12} /></button>}
        <button aria-label="Pausar conversación" title="Pausar (la conversación queda guardada y se puede reanudar)" onClick={onStop}><X size={13} /></button>
      </div>
    </div>
    <div className="chat-scroll" ref={scroller} aria-live="polite">
      {state.messages.length === 0 && <p className="chat-empty">Conversación nueva con {session.roleName}. Trabaja en la carpeta de este trabajo y lee el contexto de marca, el brief y las decisiones registradas.</p>}
      {state.messages.map(message => <MessageView key={message.id} message={message} roleName={session.roleName} onSaveAsDocument={onSaveAsDocument} />)}
      {state.permissions.map(permission => <PermissionCard key={permission.id} chatId={session.id} request={permission} onError={onError} />)}
      {state.questions.map(question => <QuestionCard key={question.id} chatId={session.id} request={question} onError={onError} />)}
      {busy && <div className="chat-status"><LoaderCircle className="spin" size={13} />{state.status === 'retry' ? state.statusDetail || 'Reintentando…' : 'El agente está trabajando…'}</div>}
      {state.error && <div className="chat-error" role="alert"><CircleAlert size={14} /><span>{state.error}</span><button aria-label="Cerrar error" onClick={() => chatStore.clearError(session.id)}><X size={13} /></button></div>}
    </div>
    <form className="prompt-form" onSubmit={e => { e.preventDefault(); void send(); }}>
      <textarea aria-label="Mensaje al agente" placeholder={state.closed ? 'Conversación en pausa' : '¿Qué trabajamos ahora?'} value={draft} disabled={state.closed} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <div><small>{state.closed ? 'Conversación en pausa' : busy ? 'Podés escribir; se envía cuando el agente termine' : 'Enter envía · Shift+Enter salto de línea'}</small><button className="primary icon-button" disabled={!draft.trim() || sending || busy || state.closed} aria-label="Enviar mensaje"><ArrowUpRight size={18} /></button></div>
    </form>
  </div>;
}

function MessageView({ message, roleName, onSaveAsDocument }: { message: ChatMessage; roleName: string; onSaveAsDocument?: (text: string) => void }) {
  const visible = message.parts.filter(p => p.type !== 'text' || p.text.trim().length > 0);
  if (message.role === 'user') {
    const text = message.parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n');
    return <div className="chat-message user"><div className="chat-role">Vos</div><div className="chat-bubble">{text}</div></div>;
  }
  // An answer worth keeping should not stay trapped in the conversation.
  const text = message.parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n\n').trim();
  const worthKeeping = message.completed && !message.error && text.length > 400;
  return <div className="chat-message assistant">
    <div className="chat-role">{roleName}{!message.completed && !message.error ? <LoaderCircle className="spin" size={11} /> : null}
      {worthKeeping && onSaveAsDocument && <button className="save-as-document" title="Guardar esta respuesta como un documento del trabajo" onClick={() => onSaveAsDocument(text)}><FilePlus size={12} />Guardar como documento</button>}
    </div>
    {visible.map(part => <PartView key={part.id} part={part} />)}
    {message.error && <div className="chat-error"><CircleAlert size={14} /><span>{message.error}</span></div>}
  </div>;
}

function PartView({ part }: { part: ChatPart }) {
  if (part.type === 'text') return <div className="markdown chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown></div>;
  if (part.type === 'reasoning') return <details className="chat-reasoning"><summary><ChevronRight size={12} />Razonamiento</summary><pre>{part.text}</pre></details>;
  return <details className={'chat-tool ' + part.status}>
    <summary><Wrench size={12} /><span className="chat-tool-name">{part.tool}</span><span className="chat-tool-title">{part.title}</span><span className="chat-tool-status">{part.status === 'running' ? <LoaderCircle className="spin" size={11} /> : part.status === 'completed' ? <Check size={11} /> : part.status === 'error' ? <CircleAlert size={11} /> : null}{labelFor(part.status)}</span></summary>
    {part.input && <><div className="field-label">ENTRADA</div><pre>{part.input}</pre></>}
    {part.output && <><div className="field-label">RESULTADO</div><pre>{part.output}</pre></>}
    {part.error && <div className="chat-error"><CircleAlert size={13} /><span>{part.error}</span></div>}
  </details>;
}

function labelFor(status: ChatToolStatus): string {
  switch (status) {
    case 'running': return 'en curso';
    case 'completed': return 'listo';
    case 'error': return 'error';
    default: return 'pendiente';
  }
}

function PermissionCard({ chatId, request, onError }: { chatId: string; request: ChatPermission; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const reply = (value: 'once' | 'always' | 'reject') => {
    setBusy(true);
    api.replyPermission(chatId, request.id, value).catch(e => onError(displayError(e))).finally(() => setBusy(false));
  };
  return <div className="chat-card permission" role="group" aria-label="Solicitud de permiso">
    <div className="chat-card-title"><ShieldQuestion size={15} />El agente pide permiso<strong title={request.permission}>{friendlyTool(request.permission)}</strong></div>
    {request.title && <p>{request.title}</p>}
    {request.patterns.length > 0 && <ul>{request.patterns.map(p => <li key={p}><code>{p}</code></li>)}</ul>}
    <div className="chat-card-actions">
      <button className="primary" disabled={busy} onClick={() => reply('once')}>Permitir una vez</button>
      <button disabled={busy} onClick={() => reply('always')} title={request.always.length ? `Recordar para: ${request.always.join(', ')}` : undefined}>Permitir siempre</button>
      <button disabled={busy} onClick={() => reply('reject')}>Rechazar</button>
    </div>
  </div>;
}

function QuestionCard({ chatId, request, onError }: { chatId: string; request: ChatQuestion; onError: (e: string) => void }) {
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => request.questions.map(() => ''));
  const [busy, setBusy] = useState(false);
  const toggle = (qi: number, label: string, multiple: boolean) => setAnswers(prev => prev.map((a, i) => i !== qi ? a : multiple ? (a.includes(label) ? a.filter(x => x !== label) : [...a, label]) : [label]));
  const submit = () => {
    const final = answers.map((a, i) => (custom[i].trim() ? [...a, custom[i].trim()] : a));
    if (final.some(a => a.length === 0)) return;
    setBusy(true);
    api.replyQuestion(chatId, request.id, final).catch(e => onError(displayError(e))).finally(() => setBusy(false));
  };
  const reject = () => { setBusy(true); api.replyQuestion(chatId, request.id, null).catch(e => onError(displayError(e))).finally(() => setBusy(false)); };
  return <div className="chat-card question" role="group" aria-label="Pregunta del agente">
    {request.questions.map((q, qi) => <div key={qi} className="chat-question">
      <div className="chat-card-title"><ShieldQuestion size={15} />{q.header || 'El agente pregunta'}</div>
      <p>{q.question}</p>
      <div className="chat-options">{q.options.map(o => <button key={o.label} className={answers[qi].includes(o.label) ? 'selected-option' : ''} title={o.description} onClick={() => toggle(qi, o.label, q.multiple)}>{answers[qi].includes(o.label) && <Check size={12} />}{o.label}</button>)}</div>
      {q.custom && <input aria-label="Respuesta propia" placeholder="Otra respuesta…" value={custom[qi]} onChange={e => setCustom(prev => prev.map((c, i) => (i === qi ? e.target.value : c)))} />}
    </div>)}
    <div className="chat-card-actions">
      <button className="primary" disabled={busy || answers.some((a, i) => a.length === 0 && !custom[i].trim())} onClick={submit}>Responder</button>
      <button disabled={busy} onClick={reject}>No responder</button>
    </div>
  </div>;
}
