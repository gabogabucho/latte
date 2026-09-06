// Regression + screenshots for the Settings screen through Electron's real
// sandboxed preload. Disposable data dir, no inference, no external calls.
// Usage: node_modules/electron/dist/electron.exe scripts/visual-settings.cjs
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-visual-settings-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');

const SIZES = [{ w: 1280, h: 800, tag: '1280x800' }, { w: 1440, h: 1000, tag: '1440x1000' }];

app.whenReady().then(async () => {
  let backend, win, unregister;
  const errors = [];
  const result = { shots: [] };
  try {
    win = new BrowserWindow({ width: SIZES[0].w, height: SIZES[0].h, show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    backend = await createBackend({
      dataDir: path.join(root, 'data'),
      emit: event => win.webContents.send('latte:agent-event', event),
      emitChat: event => win.webContents.send('latte:chat-event', event),
      chooseExportPath: async () => null,
      seedDemo: true,
    });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 900));

    // 1. Type an unsaved draft in the document editor, then open Settings.
    Object.assign(result, await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const click = async text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); if (!b) throw new Error('Missing button: ' + text); b.click(); await pause(280); };
      const setValue = async (selector, text) => { const el = document.querySelector(selector); if (!el) throw new Error('Missing: ' + selector); const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); await pause(200); };
      await click('Editar');
      await setValue('[aria-label="Editar documento en Markdown"]', '# Borrador sin guardar');
      const draftBefore = document.querySelector('[aria-label="Editar documento en Markdown"]').value;
      await click('Ajustes');
      await pause(400);
      const controls = {
        tabs: Boolean([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Brief')),
        decisions: Boolean([...document.querySelectorAll('button')].some(b => b.textContent.includes('Decisiones'))),
        exportButton: Boolean(document.querySelector('[title="Exportar Markdown"]')),
        versionsFooter: Boolean(document.querySelector('.document-footer')),
        teamPanel: Boolean(document.querySelector('.agent-panel')),
        editor: Boolean(document.querySelector('[aria-label="Editar documento en Markdown"]')),
        breadcrumb: Boolean(document.querySelector('.breadcrumb')),
      };
      const settingsScreen = Boolean(document.querySelector('.settings-shell'));
      const title = document.querySelector('.settings-topbar h1')?.textContent ?? '';
      const sections = [...document.querySelectorAll('.settings-nav button')].map(b => b.textContent.trim());
      return { draftBefore, controls, settingsScreen, title, sections };
    })()`));
    for (const size of SIZES) {
      win.setSize(size.w, size.h);
      await new Promise(resolve => setTimeout(resolve, 500));
      const file = path.join(__dirname, '..', 'assets', `latte-settings-${size.tag}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      result.shots.push(path.basename(file));
    }

    // 2. The local space section shows real installation facts.
    result.workspaceFacts = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('.settings-nav button')].find(b => b.textContent.includes('Espacio local')).click();
      await pause(450);
      const dd = [...document.querySelectorAll('.settings-facts dd')].map(d => d.textContent.trim());
      return { dataDir: dd[0] ?? '', engine: dd[1] ?? '', pack: dd[2] ?? '' };
    })()`);

    // 2b. The MCP section lists what each runtime really has configured.
    result.tools = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('.settings-nav button')].find(b => b.textContent.includes('Herramientas')).click();
      await pause(600);
      for (let i = 0; i < 60 && document.querySelectorAll('.runtime-card').length === 0; i++) await pause(500);
      const cards = [...document.querySelectorAll('.tools-view .runtime-card')].map(c => c.querySelector('strong')?.textContent ?? '');
      const servers = [...document.querySelectorAll('.mcp-card')].map(c => ({
        name: c.querySelector('strong')?.textContent ?? '',
        status: c.querySelector('.mcp-dot')?.className.replace('mcp-dot', '').trim() ?? '',
      }));
      const openText = [...document.querySelectorAll('.tools-view .footnote')].map(f => f.textContent).join(' ');
      return { runtimeCards: cards, servers: servers.slice(0, 12), mentionsInteractive: openText.includes('opencode mcp add') };
    })()`);
    const toolsShot = path.join(__dirname, '..', 'assets', 'latte-tools-1280x800.png');
    win.setSize(1280, 800);
    await new Promise(resolve => setTimeout(resolve, 600));
    fs.writeFileSync(toolsShot, (await win.webContents.capturePage()).toPNG());
    result.shots.push(path.basename(toolsShot));

    // 3. Back to the work: the draft, the work and the editor mode survive.
    Object.assign(result, await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('Volver al trabajo')).click();
      await pause(450);
      const editor = document.querySelector('[aria-label="Editar documento en Markdown"]');
      return { draftAfter: editor ? editor.value : null, backToWork: Boolean(document.querySelector('.app-shell')), teamPanelBack: Boolean(document.querySelector('.agent-panel')) };
    })()`));
    for (const size of SIZES) {
      win.setSize(size.w, size.h);
      await new Promise(resolve => setTimeout(resolve, 500));
      const file = path.join(__dirname, '..', 'assets', `latte-workspace-${size.tag}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      result.shots.push(path.basename(file));
    }

    // Nothing was written to disk by entering/leaving Settings.
    const work = (await backend.service.listWorks((await backend.service.listBrands())[0].id))[0];
    result.diskUntouched = !work.brief.includes('Borrador sin guardar');
    result.errors = errors;
    const documentControls = Object.entries(result.controls).filter(([, present]) => present).map(([name]) => name);
    result.documentControlsInSettings = documentControls;
    fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa-settings-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!result.settingsScreen || documentControls.length > 0 || result.draftAfter !== result.draftBefore || !result.backToWork || !result.teamPanelBack || !result.diskUntouched || errors.length) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  unregister?.(); backend?.service.shutdown(); win?.destroy(); app.exit(process.exitCode || 0);
});
