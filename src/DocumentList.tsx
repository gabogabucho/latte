import { useEffect, useState } from 'react';
import { FileText, FolderOpen, Plus, RefreshCw, Search } from 'lucide-react';
import type { DocumentState, DocumentStatus, FunnelStage, WorkDocument } from '../shared/contracts';
import { filterDocuments, reviewReasons, STAGES, STAGE_LABEL, STATUS_LABEL } from './document-organizer';
import { FolderContents } from './FolderContents';

interface Untracked { fileName: string; title: string; funnelStages?: FunnelStage[] }

/**
 * The column you navigate from, next to the document instead of on top of it.
 *
 * Everything that used to be a stacked strip lives here: search, filters, the
 * review queue and what the folder holds. The document keeps the full height
 * of the screen, which is the only reason any of this exists.
 */
export function DocumentList({ documents, workId, selectedId, states, failed, checking, onRefresh, onSelect, onCreate, onUseFolder, folder, untracked, onTrack, suggestion, onImported, busy }: {
  documents: WorkDocument[];
  workId: string;
  selectedId: string | null;
  states: Record<string, DocumentState>;
  failed: string[];
  checking: boolean;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onUseFolder: () => void;
  folder: string | null;
  untracked: Untracked[];
  onTrack: (fileName: string) => Promise<void>;
  /** The usual next document, offered once. Help, never a required sequence. */
  suggestion: { label: string; hint: string } | null;
  onImported: (fileNames: string[]) => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<FunnelStage | 'all' | 'unclassified'>('all');
  const [status, setStatus] = useState<DocumentStatus | 'all'>('all');
  const [onlyReview, setOnlyReview] = useState(false);
  useEffect(() => { setQuery(''); setStage('all'); setStatus('all'); setOnlyReview(false); }, [workId]);

  const needsReview = (d: WorkDocument) => reviewReasons(d, states[d.id]?.baseOutdated ?? false);
  const reviewCount = documents.filter(d => needsReview(d).length).length;
  const filtered = filterDocuments(documents, { query, stage, status });
  const visible = onlyReview ? filtered.filter(d => needsReview(d).length) : filtered;

  return <aside className="doc-list" aria-label="Documentos del trabajo">
    <header>
      <h2>Documentos <small>{documents.length}</small></h2>
      <button onClick={onCreate} disabled={busy}><Plus size={14} />Documento</button>
    </header>

    <div className="doc-list-filters">
      <label className="doc-list-search"><Search size={14} /><input aria-label="Buscar documentos" placeholder="Buscar" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div>
        <select aria-label="Filtrar por etapa" value={stage} onChange={e => setStage(e.target.value as typeof stage)}>
          <option value="all">Todas las etapas</option>
          {[...STAGES, 'unclassified' as const].map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
        <select aria-label="Filtrar por estado" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
          <option value="all">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([s, label]) => <option key={s} value={s}>{label}</option>)}
        </select>
      </div>
      <button className={'doc-list-review' + (onlyReview ? ' on' : '')} aria-pressed={onlyReview} onClick={() => setOnlyReview(v => !v)}>
        Revisión <small>{checking && !reviewCount ? '…' : reviewCount}</small>
      </button>
    </div>

    {failed.length > 0 && <div role="alert" className="explorer-warning">No se pudo verificar {failed.length} documento(s).<button onClick={onRefresh}>Reintentar</button></div>}

    <div className="doc-list-rows">
      {visible.map(d => <button key={d.id} data-document-id={d.id} disabled={busy} className={'doc-row' + (selectedId === d.id ? ' selected' : '')} onClick={() => onSelect(d.id)} aria-label={'Abrir documento: ' + d.title} aria-current={selectedId === d.id}>
        <FileText size={14} />
        <span>
          <strong>{d.title}</strong>
          <small>{STATUS_LABEL[d.status]} · {d.fileName}</small>
          {d.proposedFunnelStages.length > 0 && <em className="proposed">Propuesta: {d.proposedFunnelStages.map(s => STAGE_LABEL[s]).join(' + ')}</em>}
          {needsReview(d).map(reason => <em key={reason}>{reason}</em>)}
          {failed.includes(d.id) && <em>No se pudo verificar la base</em>}
        </span>
      </button>)}
      {visible.length === 0 && <p className="stage-empty">{onlyReview ? 'Nada para revisar.' : 'Ningún documento coincide.'}</p>}
    </div>

    <FolderContents workId={workId} untracked={untracked} onTrack={onTrack} onImported={onImported} busy={busy} />

    {suggestion && <div className="doc-suggestion">
      <span><strong>{suggestion.label}</strong> {suggestion.hint}</span>
      <button onClick={onCreate} disabled={busy}><Plus size={13} />Crear</button>
    </div>}

    <footer className="doc-list-footer">
      {folder
        ? <span title={folder}><FolderOpen size={12} /><code>{folder}</code></span>
        : <><span><FolderOpen size={12} />Dentro de Latte</span><button onClick={onUseFolder} disabled={busy}>Usar mi carpeta</button></>}
      <button className="icon-button" aria-label="Actualizar revisión" disabled={checking} onClick={onRefresh}><RefreshCw size={12} /></button>
    </footer>
  </aside>;
}
