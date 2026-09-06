import { describe, expect, it } from 'vitest';
import { attachCloseGuard, type CloseGuardWindow } from '../../electron/windowClose';

/** A stand-in for BrowserWindow: records whether the close was vetoed. */
function fakeWindow() {
  let listener: ((event: { preventDefault(): void }) => void) | null = null;
  const state = { closes: 0, vetoed: 0, destroyed: false };
  const win: CloseGuardWindow = {
    on(_event, fn) { listener = fn; return win; },
    close() {
      state.closes += 1;
      let prevented = false;
      listener?.({ preventDefault: () => { prevented = true; } });
      if (prevented) state.vetoed += 1;
      else state.destroyed = true;
    },
  };
  return { win, state };
}

describe('The close button always works (regression: the X did nothing)', () => {
  it('closes straight away when there is no unsaved work', () => {
    const { win, state } = fakeWindow();
    let asked = 0;
    attachCloseGuard(win, { hasUnsavedWork: () => false, confirm: () => { asked += 1; return true; } });
    win.close();
    expect(state.destroyed).toBe(true);
    expect(state.vetoed).toBe(0);
    // Open chats or terminals are not unsaved work: nothing is asked.
    expect(asked).toBe(0);
  });

  it('asks once with unsaved work and closes when the user confirms', () => {
    const { win, state } = fakeWindow();
    let asked = 0;
    attachCloseGuard(win, { hasUnsavedWork: () => true, confirm: () => { asked += 1; return true; } });
    win.close();
    expect(asked).toBe(1);
    expect(state.destroyed).toBe(true);
    // Confirming must not re-open the question and trap the window.
    expect(state.vetoed).toBe(1);
    expect(state.closes).toBe(2);
  });

  it('stays open when the user cancels, and can be closed again afterwards', () => {
    const { win, state } = fakeWindow();
    let answer = false;
    let asked = 0;
    attachCloseGuard(win, { hasUnsavedWork: () => true, confirm: () => { asked += 1; return answer; } });
    win.close();
    expect(state.destroyed).toBe(false);
    expect(state.vetoed).toBe(1);

    // The user cancelled; the window must still respond to a later close.
    answer = true;
    win.close();
    expect(asked).toBe(2);
    expect(state.destroyed).toBe(true);
  });

  it('never traps the window when the unsaved state flips while it is open', () => {
    const { win, state } = fakeWindow();
    let unsaved = true;
    attachCloseGuard(win, { hasUnsavedWork: () => unsaved, confirm: () => false });
    win.close();
    expect(state.destroyed).toBe(false);
    // The user saves, then closes: no question, no veto.
    unsaved = false;
    win.close();
    expect(state.destroyed).toBe(true);
  });
});
