/**
 * Unsaved editor state, kept outside the component tree.
 *
 * The documents pane unmounts whenever the user opens Settings, switches to
 * another view or picks another work. Nothing the human typed may be lost by
 * that, and nothing may be written to disk to "rescue" it either: the draft
 * simply waits here until they save or discard it.
 */
export interface DocumentDraft {
  content: string;
  /** The version this draft started from; a save must present it. */
  fingerprint: string;
  dirty: boolean;
  mode: 'read' | 'edit';
}

const drafts = new Map<string, DocumentDraft>();

export const documentDrafts = {
  get(documentId: string): DocumentDraft | undefined {
    return drafts.get(documentId);
  },
  set(documentId: string, draft: DocumentDraft): void {
    drafts.set(documentId, draft);
  },
  /** Called once the content is safely on disk (or explicitly discarded). */
  clear(documentId: string): void {
    drafts.delete(documentId);
  },
  hasUnsaved(): boolean {
    for (const draft of drafts.values()) if (draft.dirty) return true;
    return false;
  },
};
