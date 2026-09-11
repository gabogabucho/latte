import { translate as t } from './i18n';
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
      onNotice(t('outcome.saved'));
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

  return <WorkOutcomeView expected={(work.expectedOutput ?? '').trim()} linked={linked} linkedPresent={linkedPresent} linkedMissing={linkedMissing} listed={listing !== null} files={files.map(f => f.fileName)} draft={draft} picked={picked} editing={editing} dirty={dirty} saving={saving} busy={busy} desktop={isDesktop} onToggle={() => setEditing(e => !e)} onChange={change} onOpen={open} onRefresh={() => setRefresh(n => n + 1)} onSave={() => void save()} />;
}

interface WorkOutcomeViewProps {
  /** The saved expected output, trimmed; empty when it is not set. */
  expected: string;
  linked: string | null;
  /** The linked file is in the Deliverables list that was read. */
  linkedPresent: boolean;
  /** A list was read and the linked file is not in it. */
  linkedMissing: boolean;
  /** Deliverables were actually listed, so a draft link outside them can be called missing. */
  listed: boolean;
  files: string[];
  draft: Draft;
  /** The draft link, when it is one of the listed files. */
  picked: string | null;
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  busy: boolean;
  /** Linking needs the desktop app; the preview says so instead of offering it. */
  desktop: boolean;
  onToggle: () => void;
  onChange: (next: Draft) => void;
  onOpen: (fileName: string) => void;
  onRefresh: () => void;
  onSave: () => void;
}

/**
 * The outcome bar and its form, from props alone: no state and no backend, so
 * both languages render from the same markup. Every visible or announced
 * string comes from the catalogs.
 */
export function WorkOutcomeView(props: WorkOutcomeViewProps) {
  const { expected, linked, linkedPresent, linkedMissing, draft, picked, editing, dirty, saving, busy, desktop } = props;
  return <section className="work-outcome" aria-label={t('outcome.region')}>
    <div className="work-outcome-bar">
      <Target size={14} />
      <span className="work-outcome-summary" title={expected || undefined}>
        <strong>{t('outcome.label')}</strong>{expected ? expected : <em>{t('outcome.unset')}</em>}
      </span>
      {linked && <span className={'work-outcome-file' + (linkedMissing ? ' missing' : '')} title={linkedMissing ? t('outcome.missingTitle', { file: linked }) : linked}>
        <Package size={13} />
        <span>{linked}{linkedMissing ? t('outcome.missingSuffix') : ''}</span>
        {desktop && linkedPresent && <button className="icon-button" aria-label={t('outcome.open', { file: linked })} title={t('outcome.openWithSystem')} disabled={busy} onClick={() => props.onOpen(linked)}><ExternalLink size={12} /></button>}
      </span>}
      <button aria-expanded={editing} disabled={busy} onClick={props.onToggle}>{editing ? t('outcome.close') : t('outcome.edit')}{dirty ? t('outcome.unsaved') : ''}</button>
    </div>

    {editing && <div className="work-outcome-fields">
      <label>{t('outcome.question')}
        <textarea aria-label={t('outcome.label')} rows={2} maxLength={2000} value={draft.expectedOutput} disabled={saving} placeholder={t('outcome.placeholder')} onChange={e => props.onChange({ ...draft, expectedOutput: e.target.value })} />
      </label>
      {desktop
        ? <div className="work-outcome-link">
          <label>{t('outcome.linked')}
            <select aria-label={t('outcome.linked')} value={draft.resultPath} disabled={saving} onChange={e => props.onChange({ ...draft, resultPath: e.target.value })}>
              <option value="">{t('outcome.notLinked')}</option>
              {draft.resultPath && !picked && <option value={draft.resultPath}>{draft.resultPath}{props.listed ? t('outcome.optionMissing') : ''}</option>}
              {props.files.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <button className="icon-button" aria-label={t('outcome.openPicked')} title={t('outcome.openWithSystem')} disabled={!picked || saving} onClick={() => picked && props.onOpen(picked)}><ExternalLink size={13} /></button>
          <button className="icon-button" aria-label={t('outcome.refreshList')} title={t('outcome.refresh')} disabled={saving} onClick={props.onRefresh}><RefreshCw size={12} /></button>
        </div>
        : <p className="footnote">{t('outcome.desktopOnly')}</p>}
      <div className="metadata-save">
        <small>{t('outcome.help')}</small>
        <button className="primary" disabled={!dirty || saving || busy} onClick={props.onSave}>{t('outcome.save')}</button>
      </div>
    </div>}
  </section>;
}
