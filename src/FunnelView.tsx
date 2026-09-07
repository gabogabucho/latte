import { FileText, RefreshCw } from 'lucide-react';
import type { DocumentState, WorkDocument } from '../shared/contracts';
import { groupByStage, reviewReasons, STAGES, STAGE_LABEL, STATUS_LABEL } from './document-organizer';

/**
 * The campaign by funnel stage, on its own screen.
 *
 * An empty stage collapses to a single line. The first version gave each one a
 * full card, so a new work spent four blocks of screen saying "nothing here"
 * and pushed the unclassified documents — every document there is — below the
 * fold. A zero is worth one line; what you have to work on is worth the space.
 */
export function FunnelView({ documents, selectedId, states, checking, onRefresh, onSelect, busy }: {
  documents: WorkDocument[];
  selectedId: string | null;
  states: Record<string, DocumentState>;
  checking: boolean;
  onRefresh: () => void;
  onSelect: (id: string) => void;
  busy: boolean;
}) {
  const groups = groupByStage(documents);
  const empty = STAGES.filter(s => groups[s].length === 0);

  const card = (d: WorkDocument) => <button key={d.id} data-document-id={d.id} disabled={busy} className={'funnel-card' + (selectedId === d.id ? ' selected' : '')} onClick={() => onSelect(d.id)} aria-label={'Abrir documento: ' + d.title}>
    <FileText size={14} />
    <span>
      <strong>{d.title}</strong>
      <small>{STATUS_LABEL[d.status]} · {d.fileName}</small>
      {d.proposedFunnelStages.length > 0 && <em className="proposed">Propuesta: {d.proposedFunnelStages.map(s => STAGE_LABEL[s]).join(' + ')}</em>}
      {reviewReasons(d, states[d.id]?.baseOutdated ?? false).map(reason => <em key={reason}>{reason}</em>)}
    </span>
  </button>;

  return <div className="funnel-view">
    <header className="funnel-head">
      <div>
        <span className="eyebrow">EMBUDO DE CAMPAÑA</span>
        <h2>Dónde está parada cada pieza</h2>
      </div>
      <button className="icon-button" aria-label="Actualizar embudo" disabled={checking} onClick={onRefresh}><RefreshCw size={13} /></button>
    </header>
    <p className="explorer-hint">Un documento puede participar en varias etapas: siempre es el mismo archivo. La clasificación es virtual y no mueve nada.</p>

    {groups.unclassified.length > 0 && <section className="funnel-block unclassified" aria-label="Sin clasificar">
      <h3>Sin clasificar <small>{groups.unclassified.length}</small></h3>
      <p className="stage-empty">Asignales una etapa desde Organizar, o pedile al agente que las proponga.</p>
      <div className="funnel-cards">{groups.unclassified.map(card)}</div>
    </section>}

    {STAGES.map((s, i) => groups[s].length > 0 && <section className={'funnel-block funnel-stage-' + i} key={s} data-stage={s} aria-label={STAGE_LABEL[s]}>
      <h3><span>{String(i + 1).padStart(2, '0')} / {STAGE_LABEL[s]}</span><small>{groups[s].length}</small></h3>
      <div className="funnel-cards">{groups[s].map(card)}</div>
    </section>)}

    {empty.length > 0 && <section className="funnel-gaps" aria-label="Etapas vacías">
      <h3>Etapas sin nada <small>{empty.length}</small></h3>
      {empty.map(s => <div key={s} data-stage={s} className="funnel-gap"><span>{String(STAGES.indexOf(s) + 1).padStart(2, '0')} / {STAGE_LABEL[s]}</span><em>vacía</em></div>)}
      <p className="footnote">Una etapa vacía es un hallazgo, no un detalle: es la parte del recorrido que hoy nadie está atendiendo.</p>
    </section>}
  </div>;
}
