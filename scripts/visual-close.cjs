// Regression for "the X button does nothing".
//
// The renderer must never veto a close: in Electron a cancelled beforeunload
// shows no dialog, so the window would just stop responding. It only reports
// whether there is unsaved work; the decision lives in the main process
// (electron/windowClose.ts, covered by tests/backend/windowClose.test.ts).
//
// Disposable data dir, no inference.
// Usage: node_modules/electron/dist/electron.exe scripts/visual-close.cjs
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const { attachCloseGuard } = require('../electron/windowClose.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-visual-close-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');
const pause = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  let backend, win, unregister;
  const errors = [];
  const result = {};
  let unsavedReported = null;
  let asked = 0;
  let answer = false;
  try {
    backend = await createBackend({ dataDir: path.join(root, 'data'), emit: () => {}, emitChat: () => {}, chooseExportPath: async () => null, seedDemo: true });
    win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    // Handlers first, exactly like main.ts, so the renderer's first calls work.
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    ipcMain.on('latte:unsaved', (event, value) => { if (event.sender.id === win.webContents.id) unsavedReported = value; });
    attachCloseGuard(win, { hasUnsavedWork: () => unsavedReported === true, confirm: () => { asked += 1; return answer; } });

    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    await pause(1200);
    result.reportedWhenClean = unsavedReported;

    // Open a chat-like state and an unsaved edit, then check the renderer's veto.
    await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const click = async text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); if (!b) throw new Error('Missing: ' + text); b.click(); await pause(320); };
      await click('Editar');
      const editor = document.querySelector('[aria-label="Editar documento en Markdown"]');
      const proto = Object.getPrototypeOf(editor);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(editor, '# Sin guardar');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(500);
      return true;
    })()`);
    await pause(500);
    result.reportedWhenDirty = unsavedReported;

    result.rendererVetoesClose = await win.webContents.executeJavaScript(`(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    })()`);

    // Cancel once: the window stays open and is still responsive.
    const closedOnce = new Promise(resolve => win.once('closed', () => resolve(true)));
    win.close();
    result.stayedOpenOnCancel = (await Promise.race([closedOnce, pause(1500).then(() => false)])) === false;

    // Confirm: it actually closes.
    answer = true;
    const closedTwice = new Promise(resolve => win.once('closed', () => resolve(true)));
    win.close();
    result.closedOnConfirm = await Promise.race([closedTwice, pause(4000).then(() => false)]);
    result.asked = asked;
    result.errors = errors;

    console.log(JSON.stringify(result));
    const ok = result.reportedWhenClean === false
      && result.reportedWhenDirty === true
      && result.rendererVetoesClose === false
      && result.stayedOpenOnCancel
      && result.closedOnConfirm
      && result.asked === 2
      && errors.length === 0;
    if (!ok) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  unregister?.(); backend?.service.shutdown(); app.exit(process.exitCode || 0);
});
