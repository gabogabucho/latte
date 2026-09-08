import { describe, expect, it } from 'vitest';
import { attachCloseGuard, attachQuitGuard, type CloseGuardWindow, type QuitGuardApp } from '../../electron/windowClose';

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

/** A stand-in for `app`: fires 'before-quit' and records whether it was vetoed. */
function fakeApp() {
  let listener: ((event: { preventDefault(): void }) => void) | null = null;
  const state = { quits: 0, vetoed: 0 };
  const app: QuitGuardApp = { on(_event, fn) { listener = fn; return app; } };
  const quit = () => {
    state.quits += 1;
    let prevented = false;
    listener?.({ preventDefault: () => { prevented = true; } });
    if (prevented) state.vetoed += 1;
    return !prevented;
  };
  return { app, state, quit };
}

describe('One restart is questioned once (regression: quitting killed the backend first)', () => {
  function guard(options: { unsaved: boolean; answer?: boolean }) {
    const { app, state, quit } = fakeApp();
    const log = { asked: 0, stopped: 0, decided: 0 };
    let decided = false;
    let unsaved = options.unsaved;
    attachQuitGuard(app, {
      hasUnsavedWork: () => unsaved,
      confirm: () => { log.asked += 1; return options.answer !== false; },
      isDecided: () => decided,
      decide: () => { log.decided += 1; decided = true; },
      stop: () => { log.stopped += 1; },
    });
    return { state, quit, log, decide: () => { decided = true; }, setUnsaved: (v: boolean) => { unsaved = v; } };
  }

  it('stops the backend straight away when nothing is unsaved', () => {
    const g = guard({ unsaved: false });
    expect(g.quit()).toBe(true);
    expect(g.log.asked).toBe(0);
    expect(g.log.stopped).toBe(1);
  });

  it('cancelling a quit leaves the backend running', () => {
    const g = guard({ unsaved: true, answer: false });
    expect(g.quit()).toBe(false);
    expect(g.state.vetoed).toBe(1);
    // The whole point: a window that stays open must keep a live backend.
    expect(g.log.stopped).toBe(0);
    expect(g.log.decided).toBe(0);

    // And the app must still be quittable afterwards.
    g.setUnsaved(false);
    expect(g.quit()).toBe(true);
    expect(g.log.stopped).toBe(1);
  });

  it('does not ask again when the decision was already taken elsewhere', () => {
    const g = guard({ unsaved: true, answer: false });
    // An update the user confirmed: the question was asked by the updater.
    g.decide();
    expect(g.quit()).toBe(true);
    expect(g.log.asked).toBe(0);
    expect(g.log.stopped).toBe(1);
  });
});

describe('A quit decided elsewhere never asks at the window either', () => {
  it('closes without a question after allowClose()', () => {
    const { win, state } = fakeWindow();
    let asked = 0;
    const handle = attachCloseGuard(win, { hasUnsavedWork: () => true, confirm: () => { asked += 1; return false; } });
    handle.allowClose();
    win.close();
    expect(asked).toBe(0);
    expect(state.destroyed).toBe(true);
  });

  it('tells the caller when the user confirmed here, so the quit stops asking', () => {
    const { win } = fakeWindow();
    let confirmations = 0;
    attachCloseGuard(win, {
      hasUnsavedWork: () => true,
      confirm: () => true,
      onConfirmed: () => { confirmations += 1; },
    });
    win.close();
    expect(confirmations).toBe(1);
  });
});
