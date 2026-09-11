// Isolated conversation-focus regression. No installed CLI, credentials or inference.
// Start Vite separately, then: electron scripts/visual-focus.cjs
// LATTE_FOCUS_URL overrides the default http://127.0.0.1:5173. Outputs stay in a printed temp folder.
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-focus-'));
app.setPath('userData', path.join(root, 'profile'));
app.commandLine.appendSwitch('disable-gpu');
const pause = ms => new Promise(r => setTimeout(r, ms));
const message = (id, text) => ({ id, chatId: 'focus-fixture', role: 'assistant', parts: [{ type: 'text', id: id + '-text', text }], createdAt: new Date().toISOString(), completed: true, error: null });
const answer = '## Lectura de la campaña\n\n' + ('Primero revisamos objetivo, inversión y resultados antes de recomendar cambios. Estos son datos ficticios para verificar la interfaz, no una conexión con Meta.\n\n').repeat(4);
app.whenReady().then(async () => {
  let backend, win, unregister;
  const result = { root, checks: {}, shots: [], layouts: [], errors: [] };
  const check = (name, value) => { result.checks[name] = Boolean(value); if (!value) throw new Error('FAILED: ' + name); };
  try {
    win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    backend = await createBackend({ dataDir: path.join(root, 'data'), seedDemo: true, emit: () => {}, chooseExportPath: async () => null,
      runner: async () => ({ code: 1, stdout: '', stderr: 'Fixture: runtime disabled', timedOut: false }),
      loadPty: () => ({ ok: false, error: 'Fixture: PTY disabled' }),
      // Env aislado por plataforma: win32 conserva APPDATA/LOCALAPPDATA; POSIX usa XDG_* (sin APPDATA).
      env: process.platform === 'win32'
        ? { HOME: root, USERPROFILE: root, PATH: '', APPDATA: root, LOCALAPPDATA: root }
        : { HOME: root, PATH: '', XDG_CONFIG_HOME: path.join(root, 'xdg-config'), XDG_DATA_HOME: path.join(root, 'xdg-data') },
    });
    const brand = (await backend.service.listBrands())[0];
    const work = (await backend.service.listWorks(brand.id))[0];
    await backend.service.createWork(brand.id, 'Segundo trabajo QA');
    const member = { id: 'focus-fixture', workId: work.id, roleId: 'analyst', roleName: 'Analyst', initial: 'A', runtime: 'claude', model: null, accountId: null, label: 'Claude · fixture sin conexión', status: 'paused', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    let opens = 0;
    backend.service.listTeam = async id => id === work.id ? [member] : [];
    backend.service.openTeamMember = async () => { opens++; return { id: member.id, workId: work.id, provider: 'claude', model: null, accountId: null, label: member.label, resumed: true, roleId: member.roleId, roleName: member.roleName, historyRecovered: true }; };
    backend.service.listChatMessages = async () => Array.from({ length: 8 }, (_, i) => message('history-' + i, answer));
    // Fail closed: a mistaken UI action must never reach a real provider.
    for (const key of ['sendChat', 'startChat', 'addTeamMember', 'resumeAgent', 'startAgent']) backend.service[key] = async () => { throw new Error('Fixture forbids live action: ' + key); };
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) result.errors.push(text); });
    const js = source => win.webContents.executeJavaScript(source);
    const click = async label => { await js(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}); if(!b) throw new Error('Missing button '+${JSON.stringify(label)}); b.click();})()`); await pause(350); };
    await win.loadURL(process.env.LATTE_FOCUS_URL || 'http://127.0.0.1:5173');
    await js('document.fonts.ready'); await pause(1200);
    await js(`([...document.querySelectorAll('.work-nav button')].find(b=>!b.textContent.includes('Segundo'))).click()`); await pause(450);
    check('default focus', await js(`Boolean(document.querySelector('.app-shell.conversation-focus'))`));
    await js(`document.querySelector('#active-agent').value='focus-fixture'; document.querySelector('#active-agent').dispatchEvent(new Event('change',{bubbles:true}))`); await pause(200);
    await click('Reanudar conversación'); await pause(500);
    check('compact roster', await js(`Boolean(document.querySelector('#active-agent')) && document.querySelector('#team-management').hidden`));
    await js(`window.qaPane=document.querySelector('.chat-pane'); window.qaComposer=document.querySelector('[aria-label="Mensaje al agente"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(window.qaComposer,'Borrador QA sin enviar'); window.qaComposer.dispatchEvent(new Event('input',{bubbles:true}));`);
    await pause(200);
    for (const [w,h] of [[1024,768],[1280,800],[1440,1000]]) {
      win.setSize(w,h); await pause(300);
      for (const mode of ['Conversar','Revisar']) {
        const point = await js(`(() => {const b=[...document.querySelectorAll('.workspace-modes button')].find(b=>b.textContent.trim()===${JSON.stringify(mode)});const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),region:getComputedStyle(b).getPropertyValue('-webkit-app-region')}})()`);
        win.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});
        win.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1}); await pause(350);
        check(`${w} ${mode} pointer mode`, await js(`document.querySelector('.workspace-modes button[aria-pressed="true"]').textContent.trim()===${JSON.stringify(mode)}`));
        check(`${w} ${mode} no drag`, point.region==='no-drag');
        const layout = await js(`(() => {const r=document.querySelector('.prompt-form').getBoundingClientRect();const s=document.querySelector('.chat-scroll');return {visible:r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth, same:qaPane===document.querySelector('.chat-pane')&&qaComposer===document.querySelector('[aria-label="Mensaje al agente"]'), draft:qaComposer.value, height:innerHeight, composer:{top:r.top,bottom:r.bottom,left:r.left,right:r.right}, scroll:{height:s.clientHeight,content:s.scrollHeight},overflow:document.documentElement.scrollWidth>innerWidth};})()`);
        result.layouts.push({w,h,mode,...layout}); check(`${w} ${mode} no horizontal overflow`,!layout.overflow);
        check(`${w} ${mode} composer`, layout.visible); check(`${w} ${mode} same DOM and draft`, layout.same && layout.draft === 'Borrador QA sin enviar');
        const file = path.join(root, `${mode === 'Conversar' ? 'focus' : 'review'}-${w}x${h}.png`);
        fs.writeFileSync(file,(await win.webContents.capturePage()).toPNG()); result.shots.push(file);
      }
    }
    await click('Editar');
    await js(`window.qaEditor=document.querySelector('[aria-label="Editar documento en Markdown"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(qaEditor,'# Borrador de documento QA'); qaEditor.dispatchEvent(new Event('input',{bubbles:true}));`); await pause(150);
    await click('Conversar'); await click('Revisar');
    check('document dirty preserved', await js(`qaEditor===document.querySelector('[aria-label="Editar documento en Markdown"]')&&qaEditor.value==='# Borrador de documento QA'`));
    await click('Conversar');
    await js(`document.querySelector('[aria-controls="team-management"]').click()`); await pause(200);
    check('manage preserves conversation', await js(`qaPane===document.querySelector('.chat-pane')&&!document.querySelector('#team-management').hidden`));
    await js(`document.querySelector('[aria-controls="team-management"]').click()`); await pause(200);
    await js(`const s=document.querySelector('.chat-scroll');s.scrollTop=60;s.dispatchEvent(new Event('scroll'));`); await pause(150);
    win.webContents.send('latte:chat-event', { type:'message', chatId:member.id, message:message('incoming',answer) }); await pause(350);
    check('reading position preserved', await js(`Math.abs(document.querySelector('.chat-scroll').scrollTop-60)<3`));
    await click('Hay mensajes nuevos · Ir al final');
    check('new messages jumps to bottom', await js(`(()=>{const s=document.querySelector('.chat-scroll');return s.scrollHeight-s.clientHeight-s.scrollTop<5})()`));
    // Save dirty document explicitly before adoption, so this tests adoption rather than discard confirmation.
    await click('Revisar');
    await js(`[...document.querySelectorAll('.document-toolbar button')].find(b=>b.textContent.includes('Guardar')).click()`); await pause(600);
    await click('Conversar');
    fs.writeFileSync(path.join(backend.files.workDir(brand.id,work.id),'qa-campaign.md'),'# Campaña QA\n\nArchivo ficticio de prueba.');
    win.webContents.send('latte:chat-event', {type:'status',chatId:member.id,status:'busy',detail:''}); await pause(150);
    win.webContents.send('latte:chat-event', {type:'status',chatId:member.id,status:'idle',detail:''});
    for(let i=0;i<30;i++){await pause(200);if(await js(`Boolean(document.querySelector('.answer-file-hint button'))`))break;}
    check('Fable explicit file adoption', await js(`document.querySelector('.answer-file-hint button')?.textContent.includes('qa-campaign.md') && document.querySelector('.save-as-document')?.textContent.includes('aparte')`));
    await js(`document.querySelector('.answer-file-hint button').click()`); await pause(800);
    check('adoption opens review', await js(`!document.querySelector('.app-shell.conversation-focus')`));
    check('file adopted once', (await backend.service.listDocuments(work.id)).filter(d=>d.fileName==='qa-campaign.md').length===1);
    check('adoption offer cleared', await js(`!document.querySelector('.answer-file-hint')`));
    await js(`[...document.querySelectorAll('.work-nav button')].find(b=>b.textContent.includes('Segundo')).click()`); await pause(500);
    check('new work defaults focus', await js(`Boolean(document.querySelector('.app-shell.conversation-focus'))`));
    check('session opened only once', opens===1);
    check('no renderer errors', result.errors.length===0);
  } catch (error) { result.failure=String(error.stack||error); process.exitCode=1; }
  fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
  unregister?.(); backend?.service.shutdown(); win?.destroy();
  // Keep isolated fixtures/screenshots for inspection; never delete computed user paths.
  app.exit(process.exitCode||0);
});
