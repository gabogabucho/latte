// End-to-end check of the documents slice through Electron's real sandboxed
// preload: create a strategy, edit it, provoke an external change, resolve the
// conflict, derive a calendar and see the "base changed" notice.
// Disposable data dir, no inference, no external calls.
// Usage: node_modules/electron/dist/electron.exe scripts/visual-documents.cjs
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-visual-docs-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');

const SIZES = [{ w: 1280, h: 800, tag: '1280x800' }, { w: 1440, h: 1000, tag: '1440x1000' }];
const pause = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  let backend, win, unregister;
  const errors = [];
  const result = { shots: [] };
  try {
    win = new BrowserWindow({ width: SIZES[0].w, height: SIZES[0].h, show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    backend = await createBackend({ dataDir: path.join(root, 'data'), emit: e => win.webContents.send('latte:agent-event', e), emitChat: e => win.webContents.send('latte:chat-event', e), chooseExportPath: async () => path.join(root, 'export.md'), seedDemo: true });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    await pause(900);

    const brand = (await backend.service.listBrands())[0];
    const work = (await backend.service.listWorks(brand.id))[0];
    const workDir = backend.files.workDir(brand.id, work.id);

    // 1. The seed shows separate documents, not one giant brief.
    result.seedDocuments = (await backend.service.listDocuments(work.id)).map(d => [d.kind, d.fileName, d.title]);
    result.tabsOnScreen = await win.webContents.executeJavaScript(`[...document.querySelectorAll('.doc-tabs button')].map(b => b.textContent.trim())`);

    // 2. Open the strategy tab and edit it without saving.
    result.step2 = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const click = async text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); if (!b) throw new Error('Missing button: ' + text); b.click(); await pause(320); };
      await click('Estrategia');
      await click('Editar');
      const editor = document.querySelector('[aria-label="Editar documento en Markdown"]');
      const proto = Object.getPrototypeOf(editor);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(editor, '# Mi estrategia editada a mano');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(250);
      return { saveEnabled: ![...document.querySelectorAll('button')].find(b => b.textContent.includes('Guardar') && !b.textContent.includes('contexto')).disabled };
    })()`);

    // 3. Something else writes the same file. The poll must notice and keep the draft.
    fs.writeFileSync(path.join(workDir, 'strategy.md'), '# Estrategia cambiada por fuera de Latte');
    await pause(3200);
    result.step3 = await win.webContents.executeJavaScript(`(() => ({
      banner: (document.querySelector('.doc-banner')?.innerText ?? '').replace(/\\s+/g, ' ').trim(),
      draftIntact: document.querySelector('[aria-label="Editar documento en Markdown"]')?.value ?? null,
    }))()`);
    for (const size of SIZES) {
      win.setSize(size.w, size.h); await pause(450);
      const file = path.join(__dirname, '..', 'assets', `latte-documents-${size.tag}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      result.shots.push(path.basename(file));
    }

    // 4. Saving now yields an explicit conflict with both variants on screen.
    result.step4 = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('.document-toolbar button')].find(b => b.textContent.includes('Guardar')).click();
      await pause(700);
      const panel = document.querySelector('.doc-conflict');
      return { conflictShown: Boolean(panel), text: (panel?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 240) };
    })()`);
    win.setSize(1280, 800); await pause(450);
    const conflictShot = path.join(__dirname, '..', 'assets', 'latte-conflict-1280x800.png');
    fs.writeFileSync(conflictShot, (await win.webContents.capturePage()).toPNG());
    result.shots.push(path.basename(conflictShot));

    // 5. Keep mine: the external version survives as a revision.
    result.step5 = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('.doc-conflict button')].find(b => b.textContent.includes('Guardar la mía')).click();
      await pause(800);
      return { conflictGone: !document.querySelector('.doc-conflict') };
    })()`);
    const strategyDoc = (await backend.service.listDocuments(work.id)).find(d => d.kind === 'strategy');
    result.fileAfterResolution = fs.readFileSync(path.join(workDir, 'strategy.md'), 'utf8');
    result.strategyRevisions = (await backend.service.listDocumentRevisions(strategyDoc.id)).map(r => [r.source, r.content.slice(0, 40)]);

    // 6. The calendar declares the strategy version it used; changing the base flags it.
    const calendar = (await backend.service.listDocuments(work.id)).find(d => d.kind === 'calendar');
    result.calendarBase = { base: calendar.baseDocumentId === strategyDoc.id, pinned: Boolean(calendar.baseRevisionId) };
    await backend.service.acknowledgeBase(calendar.id);
    fs.writeFileSync(path.join(workDir, 'strategy.md'), '# Estrategia otra vez distinta');
    result.baseOutdated = (await backend.service.documentState(calendar.id)).baseOutdated;
    result.step6 = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const click = async text => { const b = [...document.querySelectorAll('.doc-tabs button')].find(b => b.textContent.includes(text)); if (!b) throw new Error('Missing tab: ' + text); b.click(); await pause(500); };
      await click('Calendario');
      await pause(2600);
      return { baseBanner: (document.querySelector('.doc-banner.base')?.innerText ?? '').replace(/\\s+/g, ' ').trim() };
    })()`);

    // 6c. The new-document dialog: the close button must stay visible even
    // when the body scrolls, and it must fit without scrolling at 1280x800.
    result.dialog = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const addBtn = document.querySelector('.doc-add'); if (!addBtn) return { opened: false, why: 'no add button' }; if (addBtn.disabled) return { opened: false, why: 'add disabled' }; addBtn.click();
      await pause(1400);
      const modal = document.querySelector('.modal');
      const body = document.querySelector('.modal-body');
      const close = document.querySelector('.modal-close');
      if (!modal || !body || !close) return { opened: false, why: 'modal=' + Boolean(modal) + ' body=' + Boolean(body) + ' close=' + Boolean(close) + ' dialogs=' + document.querySelectorAll('[role=dialog]').length };
      const closeTopBefore = close.getBoundingClientRect().top;
      body.scrollTop = 99999;
      await pause(250);
      const rect = close.getBoundingClientRect();
      const result = {
        opened: true,
        width: Math.round(modal.getBoundingClientRect().width),
        closeStaysPut: Math.abs(rect.top - closeTopBefore) < 1,
        closeVisible: rect.top >= 0 && rect.bottom <= window.innerHeight,
        bodyScrolls: body.scrollHeight > body.clientHeight + 1,
        modalScrolls: modal.scrollHeight > modal.clientHeight + 1,
      };
      return result;
    })()`);

    win.setSize(1280, 800);
    await pause(500);
    const dialogShot = path.join(__dirname, '..', 'assets', 'latte-dialog-1280x800.png');
    fs.writeFileSync(dialogShot, (await win.webContents.capturePage()).toPNG());
    result.shots.push(path.basename(dialogShot));
    await win.webContents.executeJavaScript("[...document.querySelectorAll('.modal-close')].pop().click()");
    await pause(400);

    // 7. Export writes the selected document, not the work.
    await backend.service.exportDocument(calendar.id);
    result.exported = fs.readFileSync(path.join(root, 'export.md'), 'utf8').slice(0, 40);

    result.errors = errors;
    fs.writeFileSync(path.join(__dirname, '..', 'docs', 'qa-documents-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    const ok = result.step3.banner.includes('cambió fuera de Latte')
      && result.step3.draftIntact === '# Mi estrategia editada a mano'
      && result.step4.conflictShown
      && result.step5.conflictGone
      && result.fileAfterResolution === '# Mi estrategia editada a mano'
      && result.strategyRevisions.some(([source]) => source === 'external')
      && result.calendarBase.base && result.calendarBase.pinned
      && result.baseOutdated
      && result.step6.baseBanner.includes('base')
      && result.dialog.opened && result.dialog.closeStaysPut && result.dialog.closeVisible && result.dialog.modalScrolls === false && result.dialog.width >= 560
      && result.exported.startsWith('#')
      && errors.length === 0;
    if (!ok) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  unregister?.(); backend?.service.shutdown(); win?.destroy(); app.exit(process.exitCode || 0);
});
