import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Check, Download, FileText, History, Layers, LoaderCircle, Plus, RefreshCw, Save, X } from 'lucide-react';
import type { DocumentContent, DocumentKind, Revision, WorkDocument, Work } from '../shared/contracts';
import { api } from './browser-api';
import { documentDrafts } from './document-drafts';

const KIND_LABEL: Record<DocumentKind, string> = { brief: 'Encargo', strategy: 'Estrategia', calendar: 'Calendario', research: 'Investigación', copy: 'Piezas', note: 'Nota' };
const KIND_HINT: Record<DocumentKind, string> = {
  brief: 'Qué se pide y qué hay que entregar.',
  strategy: 'Objetivo, audiencia, propuesta, elecciones, restricciones y medición.',
  calendar: 'Un mes de acciones: fecha, canal, objetivo, mensaje y CTA.',
  research: 'Evidencia con fuente; lo que no tiene fuente queda como hipótesis.',
  copy: 'Piezas listas para usar, cada una con su canal y su CTA.',
  note: 'Notas de trabajo.',
};
const NEW_KINDS: DocumentKind[] = ['strategy', 'calendar', 'research', 'copy', 'note'];
const POLL_MS = 2500;
const date = (value: string) => new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
const displayError = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What the editor is holding for one document. Mirrored in documentDrafts so it survives unmounting. */
interface Editing { content: string; fingerprint: string; dirty: boolean }
/** An unresolved clash between the editor and the file on disk. */
interface Conflict { mine: string; disk: string; diskFingerprint: string; revisionId: string }

export interface DocumentsViewProps {
  work: Work | null;
  brandName: string;
  documents: WorkDocument[];
  selectedId: string | null;
  onSelect: (documentId: string) => void;
  onDocumentsChanged: () => Promise<void>;
  onWorkUpdated: (work: Work) => void;
  onDirtyChange: (dirty: boolean) => void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  onCreate: () => void;
  busy: boolean;
}

/**
 * The documents of a work: one tab per tracked Markdown file, an editor that
 * knows which version it started from, and explicit resolution when the file
 * changed underneath. Nothing is ever saved implicitly.
 */
export function DocumentsView(props: DocumentsViewProps) {
  const { work, documents, selectedId } = props;
  const selected = documents.find(d => d.id === selectedId) ?? documents[0] ?? null;
  const [editing, setEditingState] = useState<Editing | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setModeState] = useState<'read' | 'edit'>('read');
  // Every editor change is mirrored outside React, so opening Settings or
  // another view never drops what the human typed.
  const remember = (documentId: string, next: Editing | null, nextMode: 'read' | 'edit') => {
    if (!next || !next.dirty) documentDrafts.clear(documentId);
    else documentDrafts.set(documentId, { ...next, mode: nextMode });
  };
  const setEditing = (next: Editing | null) => { setEditingState(next); if (selected) remember(selected.id, next, mode); };
  const setMode = (next: 'read' | 'edit') => { setModeState(next); if (selected && editing) remember(selected.id, editing, next); };
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [external, setExternal] = useState<string | null>(null);
  const [baseOutdated, setBaseOutdated] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [pickedRevision, setPicked] = useState<Revision | null>(null);
  const [saving, setSaving] = useState(false);
  const loadToken = useRef(0);

  const load = async (documentId: string) => {
    const token = ++loadToken.current;
    setLoading(true);
    try {
      const doc = await api.readDocument(documentId);
      if (token !== loadToken.current) return;
      setEditingState({ content: doc.content, fingerprint: doc.fingerprint, dirty: false });
      documentDrafts.clear(documentId);
      setBaseOutdated(doc.baseOutdated);
      setExternal(null);
      setConflict(null);
    } catch (e) {
      if (token === loadToken.current) props.onError(displayError(e));
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  };

  // Opening a document restores a pending draft instead of re-reading over it.
  useEffect(() => {
    if (!selected) { setEditingState(null); return; }
    setShowVersions(false);
    const pending = documentDrafts.get(selected.id);
    if (pending) {
      setEditingState({ content: pending.content, fingerprint: pending.fingerprint, dirty: pending.dirty });
      setModeState(pending.mode);
      void api.documentState(selected.id).then(state => setBaseOutdated(state.baseOutdated)).catch(() => undefined);
      return;
    }
    setModeState('read');
    void load(selected.id);
  }, [selected?.id]);
  useEffect(() => { props.onDirtyChange(Boolean(editing?.dirty)); }, [editing?.dirty]);

  // Bounded polling instead of a filesystem watcher: one cheap fingerprint read
  // for the open document, only while the window is focused. Survives atomic
  // writes (temp file + rename), which break inode-based watchers.
  useEffect(() => {
    if (!selected || !editing) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || document.hidden || saving) return;
      try {
        const state = await api.documentState(selected.id);
        if (stopped) return;
        setBaseOutdated(state.baseOutdated);
        if (state.fingerprint === editing.fingerprint) { setExternal(null); return; }
        if (editing.dirty) setExternal(state.fingerprint);
        else await load(selected.id);
      } catch { /* the next tick tries again */ }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [selected?.id, editing?.fingerprint, editing?.dirty, saving]);

  const save = async () => {
    if (!selected || !editing || saving) return;
    setSaving(true);
    try {
      const outcome = await api.saveDocument(selected.id, editing.content, editing.fingerprint);
      if (outcome.status === 'conflict') {
        setConflict({ mine: editing.content, disk: outcome.disk.content, diskFingerprint: outcome.disk.fingerprint, revisionId: outcome.keptRevision.id });
        setExternal(null);
        props.onNotice('El archivo cambió fuera del editor. Guardamos esa versión y podés elegir cuál queda.');
        return;
      }
      setEditing({ content: editing.content, fingerprint: outcome.fingerprint, dirty: false });
      documentDrafts.clear(selected.id);
      setExternal(null);
      props.onWorkUpdated(outcome.work);
      await props.onDocumentsChanged();
      props.onNotice('Cambios guardados');
    } catch (e) {
      props.onError(displayError(e));
    } finally {
      setSaving(false);
    }
  };

  const keepMine = async () => {
    if (!selected || !conflict) return;
    setSaving(true);
    try {
      const outcome = await api.saveDocument(selected.id, conflict.mine, conflict.diskFingerprint);
      if (outcome.status === 'saved') {
        setEditing({ content: conflict.mine, fingerprint: outcome.fingerprint, dirty: false });
        setConflict(null);
        props.onWorkUpdated(outcome.work);
        props.onNotice('Se guardó tu versión. La anterior quedó como versión conservada.');
      } else props.onNotice('El archivo volvió a cambiar. Revisá de nuevo antes de guardar.');
    } catch (e) { props.onError(displayError(e)); } finally { setSaving(false); }
  };

  const keepDisk = async () => {
    if (!selected || !conflict) return;
    setSaving(true);
    try {
      // The human's text is archived before it leaves the editor: both variants survive.
      await api.keepDraftAsVersion(selected.id, conflict.mine);
      setEditing({ content: conflict.disk, fingerprint: conflict.diskFingerprint, dirty: false });
      setConflict(null);
      props.onNotice('Quedó la versión del archivo. Tu texto se guardó como versión conservada.');
    } catch (e) { props.onError(displayError(e)); } finally { setSaving(false); }
  };

  const snapshot = async () => {
    if (!selected) return;
    try {
      await api.snapshotDocument(selected.id);
      setRevisions(await api.listDocumentRevisions(selected.id));
      props.onNotice('Versión conservada. El documento sigue editable.');
    } catch (e) { props.onError(displayError(e)); }
  };

  const openVersions = async () => {
    if (!selected) return;
    setPicked(null);
    setShowVersions(true);
    try { setRevisions(await api.listDocumentRevisions(selected.id)); } catch (e) { props.onError(displayError(e)); }
  };

  if (!work) return <div className="empty-state"><FileText size={38} /><h1>Tu próxima idea,<br />con lugar para crecer.</h1><p>Creá una marca y un trabajo. Los documentos, las versiones y las decisiones se quedan con vos.</p></div>;

  const kindLabel = selected ? KIND_LABEL[selected.kind] : '';
  // Optional help, not a required sequence: the usual next document, offered once.
  const suggestion = !documents.some(d => d.kind === 'strategy')
    ? { label: 'Un paso habitual:', hint: 'una estrategia que decida objetivo, audiencia y elecciones antes de bajar a piezas.' }
    : !documents.some(d => d.kind === 'calendar')
      ? { label: 'Un paso habitual:', hint: 'un calendario derivado de la estrategia, con fecha, canal, mensaje y CTA.' }
      : null;
  return <div className="documents">
    <div className="doc-tabs">
      <div className="doc-tab-list" role="tablist" aria-label="Documentos del trabajo">
      {documents.map(doc => <button key={doc.id} role="tab" aria-selected={doc.id === selected?.id} className={doc.id === selected?.id ? 'selected' : ''} onClick={() => props.onSelect(doc.id)}>
        <span className="doc-kind">{KIND_LABEL[doc.kind]}</span>{doc.title.toLowerCase() === KIND_LABEL[doc.kind].toLowerCase() ? null : <span className="doc-tab-title">{doc.title}</span>}
      </button>)}
      </div>
      <button className="doc-add" onClick={props.onCreate} disabled={props.busy}><Plus size={14} />Documento</button>
    </div>

    {selected && <div className="document-toolbar">
      <span><FileText size={16} />{selected.title}<small>{kindLabel} · {editing?.dirty ? 'Sin guardar' : selected.status === 'approved' ? 'Aprobado' : selected.status === 'review' ? 'En revisión' : 'Borrador'}</small></span>
      <div className="doc-actions">
        <button className="primary" disabled={!editing?.dirty || saving || props.busy} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}Guardar</button>
        <button disabled={props.busy || saving} onClick={() => setMode(mode === 'edit' ? 'read' : 'edit')}>{mode === 'edit' ? 'Leer' : 'Editar'}</button>
        <button disabled={props.busy || saving} onClick={() => void snapshot()}><Layers size={14} />Conservar versión</button>
        <button disabled={props.busy} onClick={() => void openVersions()}><History size={14} />Versiones</button>
        <button className="icon-button" title="Exportar este documento" disabled={props.busy} onClick={() => void api.exportDocument(selected.id).then(p => p && props.onNotice('Documento exportado')).catch(e => props.onError(displayError(e)))}><Download size={15} /></button>
      </div>
    </div>}

    {conflict && <div className="doc-conflict" role="alert">
      <div className="doc-conflict-head"><AlertTriangle size={16} />Este documento cambió fuera del editor</div>
      <p>Guardamos la versión del archivo para que no se pierda. Elegí cuál queda como texto actual; la otra sigue disponible en Versiones.</p>
      <div className="revision-comparison">
        <div><h4>TU VERSIÓN (EDITOR)</h4><pre>{conflict.mine}</pre></div>
        <div><h4>VERSIÓN DEL ARCHIVO</h4><pre>{conflict.disk}</pre></div>
      </div>
      <div className="chat-card-actions">
        <button className="primary" disabled={saving} onClick={() => void keepMine()}>Guardar la mía</button>
        <button disabled={saving} onClick={() => void keepDisk()}>Quedarme con la del archivo</button>
      </div>
    </div>}

    {!conflict && external && <div className="doc-banner" role="status">
      <RefreshCw size={14} /><span>El archivo cambió fuera de Latte. Tu borrador está intacto.</span>
      <button onClick={() => void load(selected!.id)}>Ver la versión del archivo</button>
      <button onClick={() => setExternal(null)}>Seguir editando</button>
    </div>}

    {baseOutdated && selected?.baseDocumentId && <div className="doc-banner base" role="status">
      <AlertTriangle size={14} /><span>Cambió el documento que este toma como base. Revisá si sigue vigente.</span>
      <button onClick={() => props.onSelect(selected.baseDocumentId!)}>Ver la base</button>
      <button onClick={() => void api.acknowledgeBase(selected.id).then(async () => { setBaseOutdated(false); await props.onDocumentsChanged(); props.onNotice('Referencia actualizada a la versión actual de la base.'); }).catch(e => props.onError(displayError(e)))}>Ya lo revisé</button>
    </div>}

    {suggestion && <div className="doc-suggestion">
      <span><strong>{suggestion.label}</strong> {suggestion.hint}</span>
      <button onClick={props.onCreate}><Plus size={13} />Crear</button>
    </div>}

    <div className="document-scroll">
      <div className="document-kicker">{props.brandName} / {work.title}{selected ? ` / ${kindLabel}` : ''}</div>
      {loading && !editing && <p className="footnote"><LoaderCircle className="spin" size={13} /> Abriendo el documento…</p>}
      {editing && mode === 'edit' && <textarea className="markdown-editor" aria-label="Editar documento en Markdown" value={editing.content} spellCheck={false} onChange={e => setEditing({ ...editing, content: e.target.value, dirty: true })} />}
      {editing && mode === 'read' && <article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{editing.content || '*Este documento está vacío. Tocá Editar para empezar.*'}</ReactMarkdown></article>}
    </div>

    {showVersions && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowVersions(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="versions-title" className="modal wide">
        <button className="modal-close" aria-label="Cerrar" onClick={() => setShowVersions(false)}><X size={20} /></button>
        <div className="document-kicker">{kindLabel}</div>
        <h2 id="versions-title">La historia de este documento.</h2>
        <p className="intro">Versiones inmutables. Una escritura externa se marca como tal: Latte no adivina quién la hizo.</p>
        <div className="revision-layout">
          <div className="revision-list">
            {revisions.map((r, i) => <button key={r.id} className={pickedRevision?.id === r.id ? 'selected-revision' : ''} onClick={() => setPicked(r)}>
              <History size={15} /><span>Versión {revisions.length - i}<small>{date(r.createdAt)} · {r.source === 'external' ? 'cambio externo' : r.source === 'latte' ? 'referencia' : 'guardada acá'}</small></span>
            </button>)}
            {!revisions.length && <p>Sin versiones todavía. Usá «Conservar versión».</p>}
          </div>
          {pickedRevision && <div className="revision-comparison">
            <div><h4>VERSIÓN CONSERVADA</h4><pre>{pickedRevision.content}</pre></div>
            <div><h4>TEXTO ACTUAL</h4><pre>{editing?.content ?? ''}</pre></div>
          </div>}
        </div>
      </section>
    </div>}
  </div>;
}

/** Kind picker for a new document, with the option to derive it from an existing one. */
export function NewDocumentDialog({ documents, busy, onCancel, onCreate }: {
  documents: WorkDocument[];
  busy: boolean;
  onCancel: () => void;
  onCreate: (kind: DocumentKind, title: string, baseDocumentId: string | null) => Promise<void>;
}) {
  const [kind, setKind] = useState<DocumentKind>('strategy');
  const [title, setTitle] = useState('');
  const [base, setBase] = useState('');
  const suggestion = KIND_LABEL[kind];
  const canDerive = documents.filter(d => d.kind !== kind || d.id !== base);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="new-doc-title" className="modal">
      <button className="modal-close" aria-label="Cerrar" onClick={onCancel}><X size={20} /></button>
      <div className="document-kicker">UN TRABAJO, VARIOS ENTREGABLES</div>
      <h2 id="new-doc-title">Un documento nuevo.</h2>
      <p className="intro">Cada documento tiene su archivo Markdown, sus versiones y su exportación. Ninguno es obligatorio.</p>
      <div className="kind-list" role="radiogroup" aria-label="Tipo de documento">
        {NEW_KINDS.map(k => <button key={k} role="radio" aria-checked={kind === k} className={'kind-card' + (kind === k ? ' selected' : '')} onClick={() => setKind(k)}>
          <span><strong>{KIND_LABEL[k]}</strong><small>{KIND_HINT[k]}</small></span>{kind === k && <Check size={14} />}
        </button>)}
      </div>
      <label className="field-label" htmlFor="doc-title">TÍTULO</label>
      <input id="doc-title" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder={`Ej. ${suggestion} de lanzamiento`} />
      {canDerive.length > 0 && <>
        <label className="field-label" htmlFor="doc-base">¿SE APOYA EN OTRO DOCUMENTO?</label>
        <select id="doc-base" value={base} onChange={e => setBase(e.target.value)}>
          <option value="">No, empieza solo</option>
          {documents.map(d => <option key={d.id} value={d.id}>{KIND_LABEL[d.kind]} · {d.title}</option>)}
        </select>
        <p className="footnote">Latte guarda la versión exacta que tomó como base. Si esa base cambia después, este documento avisa que hay que revisarlo; no se regenera solo.</p>
      </>}
      <button className="primary" disabled={busy || !title.trim()} onClick={() => void onCreate(kind, title.trim(), base || null)}><Plus size={15} />Crear documento</button>
    </section>
  </div>;
}
