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
}

export function attachCloseGuard(win: CloseGuardWindow, options: CloseGuardOptions): void {
  let confirmed = false;
  win.on('close', (event) => {
    if (confirmed || !options.hasUnsavedWork()) return;
    event.preventDefault();
    if (!options.confirm()) return;
    // The answer is remembered so the second close is never questioned again:
    // a guard that can ask twice is a guard that can trap the window.
    confirmed = true;
    win.close();
  });
}
