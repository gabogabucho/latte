import { useEffect, useState } from 'react';
import { ExternalLink, Package, RefreshCw, Target } from 'lucide-react';
import type { DeliverableListing, Work, WorkPatch } from '../shared/contracts';
import { api, isDesktop } from './browser-api';

interface Draft { expectedOutput: string; resultPath: string }

// Drafts survive document, work and Settings navigation, like the document
// metadata: typing an expected output and switching away never drops it.
const drafts = new Map<string, Draft>();
export const hasOutcomeDrafts = () => drafts.size > 0;

const savedDraft = (work: Work): Draft => ({ expectedOutput: work.expectedOutput ?? '', resultPath: work.resultPath ?? '' });
const displayError = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The brief document of a work: the Encargo. Adopted files can share its kind, not its file. */
export const isWorkBrief = (document: { kind: string; fileName: string }) => document.kind === 'brief' && document.fileName === 'brief.md';

/**
 * What closes the work, inside the Encargo: the output the human expects and,
 * once it exists, the file of Deliverables that is the result.
 *
 * Not a new list of files. The picker is fed by Deliverables, which stays the
 * only list, and the link is a pointer into it. Whether that file is still
 * there is read from the folder every time, never kept as a state.
 */
export function WorkOutcome({ work, busy, onUpdated, onNotice, onError, onDirtyChange }: {
  work: Work;
  busy: boolean;
  onUpdated: (work: Work) => void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => drafts.get(work.id) ?? savedDraft(work));
  const [editing, setEditing] = useState(false);
  const [listing, setListing] = useState<DeliverableListing | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const dirty = drafts.has(work.id);

  // A save elsewhere (the brief itself) hands back a fresh work; follow it unless the human is mid-edit.
  useEffect(() => { if (!drafts.has(work.id)) setDraft(savedDraft(work)); }, [work.id, work.expectedOutput, work.resultPath]);

  useEffect(() => {
    if (!isDesktop) return;
    let live = true;
    api.listDeliverables(work.id)
      .then(result => { if (live) setListing(result); })
      .catch(() => { if (live) setListing(null); });
    return () => { live = false; };
  }, [work.id, refresh]);

  const change = (next: Draft) => {
    setDraft(next);
    if (next.expectedOutput === (work.expectedOutput ?? '') && next.resultPath === (work.resultPath ?? '')) drafts.delete(work.id);
    else drafts.set(work.id, next);
    onDirtyChange(hasOutcomeDrafts());
  };

  const save = async () => {
    const patch: WorkPatch = {};
    if (draft.expectedOutput !== (work.expectedOutput ?? '')) patch.expectedOutput = draft.expectedOutput;
    if (draft.resultPath !== (work.resultPath ?? '')) patch.resultPath = draft.resultPath || null;
    setSaving(true);
    try {
      const updated = await api.updateWork(work.id, patch);
      drafts.delete(work.id);
      onDirtyChange(hasOutcomeDrafts());
      setDraft(savedDraft(updated));
      onUpdated(updated);
      onNotice('Resultado esperado guardado.');
    } catch (e) {
      onError(displayError(e));
      // The usual cause is a file that left entregables/ since the list was read.
      setRefresh(n => n + 1);
    } finally {
      setSaving(false);
    }
  };

  // Opening is always the human's call, and the backend asks again for HTML.
  const open = (fileName: string) => void api.openDeliverable(work.id, fileName).catch(e => { onError(displayError(e)); setRefresh(n => n + 1); });

  const files = listing?.files ?? [];
  const linked = work.resultPath ?? null;
  const linkedPresent = Boolean(linked && files.some(f => f.fileName === linked));
  // Only a list that was actually read can say a file is missing.
  const linkedMissing = Boolean(linked && listing && !linkedPresent);
  const picked = draft.resultPath && files.some(f => f.fileName === draft.resultPath) ? draft.resultPath : null;
  const expected = (work.expectedOutput ?? '').trim();

  return <section className="work-outcome" aria-label="Resultado esperado del trabajo">
    <div className="work-outcome-bar">
      <Target size={14} />
      <span className="work-outcome-summary" title={expected || undefined}>
        <strong>Resultado esperado</strong>{expected ? expected : <em>sin definir</em>}
      </span>
      {linked && <span className={'work-outcome-file' + (linkedMissing ? ' missing' : '')} title={linkedMissing ? `${linked} ya no está en entregables/` : linked}>
        <Package size={13} />
        <span>{linked}{linkedMissing ? ' · no está en entregables/' : ''}</span>
        {isDesktop && linkedPresent && <button className="icon-button" aria-label={`Abrir ${linked}`} title="Abrir con la aplicación del sistema" disabled={busy} onClick={() => open(linked)}><ExternalLink size={12} /></button>}
      </span>}
      <button aria-expanded={editing} disabled={busy} onClick={() => setEditing(e => !e)}>{editing ? 'Cerrar' : 'Editar'}{dirty ? ' · Sin guardar' : ''}</button>
    </div>

    {editing && <div className="work-outcome-fields">
      <label>Qué tiene que entregar este trabajo
        <textarea aria-label="Resultado esperado" rows={2} maxLength={2000} value={draft.expectedOutput} disabled={saving} placeholder="Ej. Un PDF de dos páginas con la propuesta para el cliente." onChange={e => change({ ...draft, expectedOutput: e.target.value })} />
      </label>
      {isDesktop
        ? <div className="work-outcome-link">
          <label>Entregable vinculado
            <select aria-label="Entregable vinculado" value={draft.resultPath} disabled={saving} onChange={e => change({ ...draft, resultPath: e.target.value })}>
              <option value="">Sin vincular</option>
              {draft.resultPath && !picked && <option value={draft.resultPath}>{draft.resultPath}{listing ? ' (no está en entregables/)' : ''}</option>}
              {files.map(f => <option key={f.fileName} value={f.fileName}>{f.fileName}</option>)}
            </select>
          </label>
          <button className="icon-button" aria-label="Abrir el entregable elegido" title="Abrir con la aplicación del sistema" disabled={!picked || saving} onClick={() => picked && open(picked)}><ExternalLink size={13} /></button>
          <button className="icon-button" aria-label="Actualizar la lista de entregables" title="Actualizar" disabled={saving} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={12} /></button>
        </div>
        : <p className="footnote">Vincular un entregable requiere la aplicación de escritorio.</p>}
      <div className="metadata-save">
        <small>El brief sigue siendo el objetivo. Esto llega a los agentes con el contexto del trabajo; una conversación ya abierta sigue con el contexto con el que empezó.</small>
        <button className="primary" disabled={!dirty || saving || busy} onClick={() => void save()}>Guardar</button>
      </div>
    </div>}
  </section>;
}
