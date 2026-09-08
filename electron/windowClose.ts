/**
 * Closing the window must always be possible.
 *
 * A renderer that cancels `beforeunload` shows no dialog in Electron: the
 * close button simply stops working and the user is given no reason. So the
 * renderer never vetoes the close. It only reports whether there is unsaved
 * work, and the decision is taken here with a real dialog.
 */
export interface CloseGuardWindow {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown;
  close(): void;
}

export interface CloseGuardOptions {
  /** Latest state reported by the renderer. */
  hasUnsavedWork: () => boolean;
  /** Shows the confirmation. Returns true when the user chose to close anyway. */
  confirm: () => boolean;
  /** Called when the user confirmed here, so a quit already under way stops asking. */
  onConfirmed?: () => void;
}

export interface CloseGuardHandle {
  /**
   * Stops questioning every future close. Used when the decision was already
   * taken somewhere else — an update the user confirmed, for instance — so the
   * same question is never asked twice for one restart.
   */
  allowClose(): void;
  /** Re-arm after an authorized update failed and the window remains open. */
  requireConfirmation(): void;
}

export function attachCloseGuard(win: CloseGuardWindow, options: CloseGuardOptions): CloseGuardHandle {
  let confirmed = false;
  win.on('close', (event) => {
    if (confirmed || !options.hasUnsavedWork()) return;
    event.preventDefault();
    if (!options.confirm()) return;
    // The answer is remembered so the second close is never questioned again:
    // a guard that can ask twice is a guard that can trap the window.
    confirmed = true;
    options.onConfirmed?.();
    win.close();
  });
  return {
    allowClose: () => { confirmed = true; },
    requireConfirmation: () => { confirmed = false; },
  };
}

/**
 * The other end of the same decision: quitting the application.
 *
 * A quit does not always start at the window. An update the user confirmed,
 * Cmd+Q, a session logout — all of them fire 'before-quit' BEFORE the window's
 * own close handler, so stopping the backend there unconditionally is how a
 * cancelled quit ends up with a live window and a dead backend behind it.
 * Here the question comes first and the shutdown only follows a real yes.
 */
export interface QuitGuardApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown;
}

export interface QuitGuardOptions {
  hasUnsavedWork: () => boolean;
  confirm: () => boolean;
  /** True when this quit was already agreed elsewhere: nobody asks twice. */
  isDecided: () => boolean;
  /** Records the decision, for whoever is asked next. */
  decide: () => void;
  /** Stops the backend. Must be safe to call more than once. */
  stop: () => void;
}

export function attachQuitGuard(app: QuitGuardApp, options: QuitGuardOptions): void {
  app.on('before-quit', (event) => {
    if (!options.isDecided() && options.hasUnsavedWork() && !options.confirm()) {
      event.preventDefault();
      return;
    }
    options.decide();
    options.stop();
  });
}
