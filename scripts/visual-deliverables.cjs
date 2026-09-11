// End-to-end check of the deliverables slice through Electron's real sandboxed
// preload: the agent leaves files in `entregables/`, Latte lists them with
// their metadata, opening HTML asks first, and copying reports where the copy
// landed. Disposable data dir, no inference, no external calls.
// Usage: node_modules/electron/dist/electron scripts/visual-deliverables.cjs (.exe en Windows)
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-visual-deliverables-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');

const pause = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  let backend, win, unregister;
  const errors = [];
  const opened = [];
  const revealed = [];
  const asked = [];
  const copyTarget = path.join(root, 'copia', 'Propuesta Casa Oliva.pdf');
  const result = { shots: [] };
  try {
    win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    fs.mkdirSync(path.dirname(copyTarget), { recursive: true });
    backend = await createBackend({
      dataDir: path.join(root, 'data'),
      emit: e => win.webContents.send('latte:agent-event', e),
      emitChat: e => win.webContents.send('latte:chat-event', e),
      chooseExportPath: async (suggested) => { result.suggestedName = suggested; return copyTarget; },
      revealPath: async (target) => { opened.push(path.basename(target)); },
      revealFile: async (target) => { revealed.push(path.basename(target)); },
      // The human says no the first time and yes the second: opening HTML is a decision.
      confirmHtml: async (fileName) => { asked.push(fileName); return asked.length > 1; },
      seedDemo: true,
    });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });

    const brand = (await backend.service.listBrands())[0];
    const work = (await backend.service.listWorks(brand.id))[0];
    const folder = path.join(backend.files.workDir(brand.id, work.id), 'entregables');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'Propuesta Casa Oliva.pdf'), Buffer.alloc(24_000, 1));
    fs.writeFileSync(path.join(folder, 'Plan de medios.xlsx'), Buffer.alloc(9_400, 1));
    fs.writeFileSync(path.join(folder, 'presentacion.html'), '<h1>Casa Oliva</h1>');
    // Neither of these is a deliverable Latte hands over.
    fs.writeFileSync(path.join(folder, 'instalador.exe'), 'no');
    fs.mkdirSync(path.join(folder, 'fuentes'), { recursive: true });

    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    await pause(1200);

    // The work opens on its conversation; the documents column lives in "Revisar".
    await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('.workspace-modes button')].find(b => b.textContent.trim() === 'Revisar'); if (!b) throw new Error('Falta el botón Revisar'); b.click(); })()`);
    await pause(700);

    // 1. The panel counts what is there before it is opened, and lists it once open.
    result.panel = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const section = document.querySelector('[aria-label="Entregables del trabajo"]');
      if (!section) throw new Error('Falta el panel de entregables');
      const header = section.querySelector('header button');
      const closedLabel = header.innerText.replace(/\\s+/g, ' ').trim();
      header.click();
      await pause(500);
      const rows = [...section.querySelectorAll('.deliverable-row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim());
      return { closedLabel, rows, footnote: (section.querySelector('.footnote')?.innerText ?? '').slice(0, 60) };
    })()`);

    const shot = path.join(__dirname, '..', 'assets', 'latte-deliverables-1440x1000.png');
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    result.shots.push(path.basename(shot));

    // 2. Open the PDF, refuse the HTML, then accept it.
    result.actions = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const click = async label => { const b = document.querySelector('[aria-label="' + label + '"]'); if (!b) throw new Error('Falta el botón: ' + label); b.click(); await pause(600); };
      await click('Abrir Propuesta Casa Oliva.pdf');
      await click('Abrir presentacion.html');
      await click('Abrir presentacion.html');
      await click('Mostrar Propuesta Casa Oliva.pdf en la carpeta');
      await click('Copiar Propuesta Casa Oliva.pdf a otra carpeta');
      const section = document.querySelector('[aria-label="Entregables del trabajo"]');
      return {
        note: (section.querySelector('.deliverable-note')?.innerText ?? '').replace(/\\s+/g, ' ').trim(),
        error: (section.querySelector('[role="alert"]')?.innerText ?? '').trim(),
      };
    })()`);

    result.opened = opened;
    result.revealed = revealed;
    result.asked = asked;
    result.copied = fs.existsSync(copyTarget) && fs.readFileSync(copyTarget).length === 24_000;
    result.originalKept = fs.existsSync(path.join(folder, 'Propuesta Casa Oliva.pdf'));
    result.errors = errors;
    fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa-deliverables-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));

    const ok = result.panel.closedLabel.includes('Entregables')
      && result.panel.rows.length === 3
      && result.panel.rows.some(r => r.includes('Propuesta Casa Oliva.pdf') && r.includes('PDF') && r.includes('KB'))
      && result.panel.rows.every(r => !r.includes('instalador.exe') && !r.includes('fuentes'))
      && opened.join() === 'Propuesta Casa Oliva.pdf,presentacion.html'
      && asked.join() === 'presentacion.html,presentacion.html'
      && revealed.join() === 'Propuesta Casa Oliva.pdf'
      && result.suggestedName === 'Propuesta Casa Oliva.pdf'
      && result.copied && result.originalKept
      && result.actions.note.includes('Copia guardada en')
      && result.actions.error === ''
      && errors.length === 0;
    if (!ok) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  unregister?.(); backend?.service.shutdown(); win?.destroy(); app.exit(process.exitCode || 0);
});
