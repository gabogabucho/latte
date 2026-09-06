// Read-only product review against a fresh, disposable Latte workspace. No inference.
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-product-review-'));
app.setPath('userData', path.join(root, 'profile'));
app.whenReady().then(async () => {
  let win, backend, unregister;
  const errors = [];
  try {
    win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    backend = await createBackend({ dataDir: path.join(root, 'data'), seedDemo: true, emit: e => win.webContents.send('latte:agent-event', e), emitChat: e => win.webContents.send('latte:chat-event', e), chooseExportPath: async () => null });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    const pause = () => new Promise(resolve => setTimeout(resolve, 700));
    const capture = async name => { await pause(); fs.writeFileSync(path.resolve(__dirname, '../assets/' + name + '.png'), (await win.webContents.capturePage()).toPNG()); };
    const click = text => win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('Missing button'); b.click(); })()`);
    await capture('latte-review-start');
    await click('Nuevo trabajo');
    await capture('latte-review-new-work');
    await win.webContents.executeJavaScript("document.querySelector('[aria-label=\"Cerrar\"]').click()");
    await click('Contexto');
    await capture('latte-review-context');
    await click('Brief');
    await click('Editar');
    win.setSize(1280, 800);
    await capture('latte-review-editor-1280');
    const metrics = await win.webContents.executeJavaScript(`(() => { const r = e => { const b=e.getBoundingClientRect(); return {x:Math.round(b.x), y:Math.round(b.y), width:Math.round(b.width), height:Math.round(b.height)} }; return { viewport:{width:innerWidth,height:innerHeight}, horizontalOverflow:document.documentElement.scrollWidth>innerWidth, editor:r(document.querySelector('.markdown-editor')), panel:r(document.querySelector('.agent-panel')), actions:[...document.querySelectorAll('.document-actions button')].map(e=>({text:e.textContent,...r(e)})) }; })()`);
    fs.writeFileSync(path.join(__dirname, 'qa-product-review-result.json'), JSON.stringify({ metrics, errors }, null, 2));
    console.log(JSON.stringify({ metrics, errors }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  unregister?.(); backend?.service.shutdown(); win?.destroy(); app.exit(process.exitCode || 0);
});
