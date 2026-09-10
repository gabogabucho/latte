// The file an agent leaves behind must become visible on its own.
//
// A real run showed the gap: the agent wrote `estrategia.md` straight to disk,
// Latte kept showing the folder as it was before, the offer to adopt it never
// appeared, and saving the chat answer produced a second copy of the same
// deliverable. This check reproduces that without spending any inference: it
// opens a real member on the local runtime, drops a file in the work folder,
// and replays the chat events a finished turn would send.
//
// Usage: node_modules/electron/dist/electron scripts/visual-adopt.cjs (.exe en Windows)
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-visual-adopt-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');
const pause = (ms) => new Promise(r => setTimeout(r, ms));

const ANSWER = [
  'Acá va la estrategia de redes, ya escrita en el archivo estrategia.md de la carpeta del trabajo.',
  '',
  'El objetivo es pasar de 38 a 60 piezas por mes en tres meses sin bajar el precio, con cuatro horas',
  'semanales de contenido y sin pauta. La audiencia son personas que cocinan en casa y compran online.',
  'La propuesta se apoya en el posicionamiento de piezas para usar, no para mirar, y el ritmo elegido es',
  'tres publicaciones por semana en Instagram más una newsletter quincenal, porque es lo que una sola',
  'persona sostiene sin bajar la calidad. Dejé marcados como PENDIENTE los datos que todavía no tengo.',
].join('\n');

app.whenReady().then(async () => {
  let backend, win, unregister;
  const errors = [];
  const result = {};
  try {
    win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    backend = await createBackend({
      dataDir: path.join(root, 'data'),
      emit: event => win.webContents.send('latte:agent-event', event),
      emitChat: event => win.webContents.send('latte:chat-event', event),
      chooseExportPath: async () => null,
      seedDemo: true,
      log: () => {},
    });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    await pause(900);

    // Open a member so the work has a live conversation, without sending anything.
    const ids = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const click = async text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); if (!b) throw new Error('Falta el botón: ' + text); b.click(); await pause(250); };
      const clickWhenEnabled = async text => { for (let i = 0; i < 240; i++) { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)); if (b && !b.disabled) { b.click(); await pause(250); return; } await pause(250); } throw new Error('Nunca se habilitó: ' + text); };
      await click('Strategist');
      await clickWhenEnabled('Abrir conversación');
      for (let i = 0; i < 200 && !document.body.innerText.includes('Activo') && !document.querySelector('.message.error'); i++) await pause(250);
      const failure = document.querySelector('.message.error')?.innerText;
      if (failure) throw new Error('No pude abrir el miembro: ' + failure);
      const brand = (await window.latte.listBrands())[0];
      const work = (await window.latte.listWorks(brand.id))[0];
      const team = await window.latte.listTeam(work.id);
      return { brandId: brand.id, workId: work.id, chatId: team[0].id };
    })()`);

    // Nothing to adopt yet: the folder has only what Latte put there.
    result.before = await win.webContents.executeJavaScript(`(() => ({
      banner: Boolean(document.querySelector('.doc-banner.untracked')),
      hint: Boolean(document.querySelector('.answer-file-hint')),
    }))()`);

    // The agent writes a file the way a real one does: straight to disk.
    const workDir = backend.files.workDir(ids.brandId, ids.workId);
    fs.writeFileSync(path.join(workDir, 'estrategia.md'), '# Estrategia de redes\n\n## Objetivo\n\nDe 38 a 60 piezas por mes.\n');

    // And the turn ends, which is the moment Latte has to look again.
    const message = {
      id: 'msg_replay_1',
      chatId: ids.chatId,
      role: 'assistant',
      parts: [{ type: 'text', id: 'part_replay_1', text: ANSWER }],
      createdAt: new Date().toISOString(),
      completed: true,
      error: null,
    };
    win.webContents.send('latte:chat-event', { chatId: ids.chatId, type: 'status', status: 'busy', detail: '' });
    await pause(400);
    win.webContents.send('latte:chat-event', { chatId: ids.chatId, type: 'message', message });
    win.webContents.send('latte:chat-event', { chatId: ids.chatId, type: 'status', status: 'idle', detail: '' });

    for (let i = 0; i < 40; i += 1) {
      await pause(250);
      const seen = await win.webContents.executeJavaScript(`Boolean(document.querySelector('.answer-file-hint'))`);
      if (seen) break;
    }
    result.after = await win.webContents.executeJavaScript(`(() => ({
      banner: (document.querySelector('.doc-banner.untracked')?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      hint: (document.querySelector('.answer-file-hint')?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      adoptButton: (document.querySelector('.answer-file-hint button')?.innerText ?? '').trim(),
      saveLabel: (document.querySelector('.save-as-document')?.innerText ?? '').trim(),
    }))()`);

    fs.writeFileSync(path.join(__dirname, '../assets/latte-adopt-desktop.png'), (await win.webContents.capturePage()).toPNG());

    // One click adopts it, and then there is nothing left to offer.
    await win.webContents.executeJavaScript(`(async () => {
      const button = document.querySelector('.answer-file-hint button');
      if (!button) throw new Error('No apareció el botón para agregar el archivo');
      button.click();
      await new Promise(r => setTimeout(r, 1500));
    })()`);
    result.adopted = await win.webContents.executeJavaScript(`(() => ({
      hintGone: !document.querySelector('.answer-file-hint'),
      tabs: [...document.querySelectorAll('.doc-tabs button')].map(b => b.innerText.trim()),
      saveLabel: (document.querySelector('.save-as-document')?.innerText ?? '').trim(),
    }))()`);
    result.documents = (await backend.service.listDocuments(ids.workId)).map(d => [d.kind, d.fileName]);
    result.untracked = (await backend.service.listUntrackedFiles(ids.workId)).map(f => f.fileName);
    result.errors = errors;
    console.log(JSON.stringify(result));

    const ok = result.before.banner === false
      && result.before.hint === false
      && result.after.hint.includes('dejó')
      && result.after.adoptButton.includes('estrategia.md')
      // The other button must say it saves the answer separately, so nobody duplicates by accident.
      && result.after.saveLabel.includes('aparte')
      && result.adopted.hintGone === true
      && result.documents.some(([, file]) => file === 'estrategia.md')
      && result.untracked.length === 0
      && errors.length === 0;
    if (!ok) process.exitCode = 1;
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    console.log(JSON.stringify({ ...result, errors }));
    process.exitCode = 1;
  }
  unregister?.(); backend?.service.shutdown(); win?.destroy();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  app.exit(process.exitCode || 0);
});
