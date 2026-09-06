// Visual + IPC smoke of the team roster through Electron's real sandboxed
// preload. Uses a temporary data directory; opens team members on the local
// OpenCode runtime WITHOUT sending any message (no inference, no cost).
// Usage: node_modules/electron/dist/electron.exe scripts/visual-team.cjs
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-visual-team-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  let backend, win, unregister;
  const errors = [];
  try {
    win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    backend = await createBackend({
      dataDir: path.join(root, 'data'),
      emit: event => win.webContents.send('latte:agent-event', event),
      emitChat: event => win.webContents.send('latte:chat-event', event),
      chooseExportPath: async () => null,
      seedDemo: true,
      log: line => console.log(line),
    });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 900));
    const result = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const panel = () => (document.querySelector('.agent-panel')?.innerText ?? '').split(String.fromCharCode(10)).map(l => l.trim()).filter(Boolean).join(' | ');
      const click = async text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); if (!b) throw new Error('Missing button: ' + text + ' | panel: ' + panel().slice(0, 1200)); b.click(); await pause(250); };
      const body = () => document.body.innerText;
      // The primary agent is "ready" only once the OpenCode runtime reports its models (lazy start, a few seconds).
      const clickWhenEnabled = async text => { for (let i = 0; i < 240; i++) { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); if (b && !b.disabled) { b.click(); await pause(250); return; } await pause(250); } throw new Error('Button never enabled: ' + text + ' | panel: ' + panel().slice(0, 600)); };
      const roles = await window.latte.listRoles();
      const rolesOnScreen = ['Asistente', 'Strategist', 'Researcher', 'Analyst', 'Reviewer'].filter(r => body().includes(r));
      // Open a Strategist with the primary agent (OpenCode by default) from the picker.
      await click('Strategist');
      await clickWhenEnabled('Abrir conversación');
      for (let i = 0; i < 200 && !body().includes('Activo') && !document.querySelector('.message.error'); i++) await pause(250);
      const failure = document.querySelector('.message.error')?.innerText;
      if (failure) throw new Error('Opening the first member failed: ' + failure);
      const afterFirst = body();
      // Add a second member: Researcher.
      await click('Sumar un rol');
      await click('Researcher');
      await clickWhenEnabled('Abrir conversación');
      for (let i = 0; i < 60 && (body().match(/Activo/g) || []).length < 2; i++) await pause(250);
      const works = await window.latte.listWorks((await window.latte.listBrands())[0].id);
      const team = await window.latte.listTeam(works[0].id);
      // Pause the researcher (selected) from the chat header, then it shows "En pausa".
      const pauseButton = document.querySelector('[aria-label="Pausar conversación"]');
      if (pauseButton) { pauseButton.click(); await pause(600); }
      const afterPause = body();
      return { roles: roles.map(r => r.id), rolesOnScreen, strategistActive: afterFirst.includes('Strategist') && afterFirst.includes('Activo'), team: team.map(m => [m.roleName, m.runtime, m.status]), pausedShown: afterPause.includes('En pausa'), resumeShown: afterPause.includes('Reanudar conversación') };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 400));
    fs.writeFileSync(path.join(__dirname, '../assets/latte-team-desktop.png'), (await win.webContents.capturePage()).toPNG());
    result.errors = errors;
    console.log(JSON.stringify(result));
    if (!result.strategistActive || result.team.length !== 2 || !result.pausedShown || errors.length) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  unregister?.(); backend?.service.shutdown(); win?.destroy(); app.exit(process.exitCode || 0);
});
