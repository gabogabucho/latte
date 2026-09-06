// Integration smoke through Electron's real sandboxed preload and IPC bridge.
// Runs against a unique temporary data directory; no agents/inference launched.
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-desktop-qa-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  let backend, win, unregister;
  try {
    win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    backend = await createBackend({ dataDir: path.join(root, 'data'), emit: event => win.webContents.send('latte:agent-event', event), chooseExportPath: async () => path.join(root, 'export.md'), seedDemo: true });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 700));
    const result = await win.webContents.executeJavaScript(`(async () => {
      if (!window.latte) throw new Error('Missing preload bridge');
      const api = window.latte;
      const b = await api.createBrand('QA desktop brand');
      const w = await api.createWork(b.id, 'QA desktop work');
      await api.updateBrand(b.id, 'Private context');
      await api.saveBrief(w.id, '# Desktop draft');
      const r = await api.snapshot(w.id);
      const d = await api.addDecision(w.id, 'Decision from real IPC');
      const location = await api.exportWork(w.id);
      let invalidRejected = false;
      try { await api.saveBrief('../escape', 'bad'); } catch { invalidRejected = true; }
      const providers = await api.runtimeStatus();
      return { bridge: true, nodeUnavailable: typeof window.require === 'undefined', brands: (await api.listBrands()).length, snapshotMatches: r.content === '# Desktop draft', decisionMatches: (await api.listDecisions(w.id))[0].id === d.id, exportLocation: location, invalidRejected, providers };
    })()`);
    result.exportMatches = fs.readFileSync(path.join(root, 'export.md'), 'utf8') === '# Desktop draft';
    result.storage = backend.info.engine;
    result.errors = errors;
    fs.writeFileSync(path.join(__dirname, '../assets/latte-native-desktop.png'), (await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(__dirname, 'qa-desktop-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!result.bridge || !result.nodeUnavailable || !result.snapshotMatches || !result.decisionMatches || !result.invalidRejected || !result.exportMatches || errors.length) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  unregister?.(); backend?.service.shutdown(); win?.destroy(); app.exit(process.exitCode || 0);
});
