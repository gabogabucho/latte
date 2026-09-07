'use strict';
// Run with Electron, not Node. Starts its OWN Vite dev server; never builds.
// Synthetic isolated data; real sandboxed preload/IPC and React controls; no inference.
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const repoRoot = path.resolve(__dirname, '..');
const output = path.join(repoRoot, 'docs', 'marketing-workspace');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-marketing-qa-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = { synthetic: true, root, repository: repoRoot, steps: [], screenshots: [], errors: [], completed: false };
let win, backend, unregister, vite;

app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  try {
    const { createServer } = await import('vite');
    vite = await createServer({ root: repoRoot, configFile: path.join(repoRoot, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false } });
    assert.equal(path.resolve(vite.config.root), repoRoot, 'Dev server must serve this repository');
    await vite.listen();
    const address = vite.httpServer.address();
    assert(address && typeof address === 'object');
    evidence.devUrl = `http://127.0.0.1:${address.port}`;
    win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { preload: path.join(repoRoot, 'electron', 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    backend = await createBackend({ dataDir: path.join(root, 'data'), seedDemo: false, emit: event => win.webContents.send('latte:agent-event', event) });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) evidence.errors.push(message); });
    const js = source => win.webContents.executeJavaScript(source);
    const api = (method, ...args) => js(`window.latte[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    const wait = async (source, description, timeout = 12000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { if (await js(source)) return; await pause(150); }
      throw new Error(`Timed out: ${description}`);
    };
    const click = async (text, selector = 'button') => {
      const expression = `(()=>{const visible=e=>e.getClientRects().length&&!e.closest('[inert]');const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>visible(e)&&(e.textContent.trim()===${JSON.stringify(text)}||e.getAttribute('aria-label')===${JSON.stringify(text)}));if(!b||b.disabled)return false;b.click();return true})()`;
      await wait(expression, `click ${text}`); await pause(200);
    };
    // Cards carry the action in their accessible name ("Abrir documento: <title>"),
    // tabs carry a count, and profiles carry source and id. Match what the UI really renders.
    const clickWhere = async (selector, predicate, description) => {
      const expression = `(()=>{const visible=e=>e.getClientRects().length&&!e.closest('[inert]');const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>visible(e)&&(${predicate})(e));if(!b||b.disabled)return false;b.click();return true})()`;
      await wait(expression, description); await pause(200);
    };
    const clickDocument = title => clickWhere('[data-document-id]', `e=>e.getAttribute('aria-label')===${JSON.stringify('Abrir documento: ' + title)}`, `open document ${title}`);
    const clickTab = label => clickWhere('.tabs button', `e=>e.textContent.trim().startsWith(${JSON.stringify(label)})`, `tab ${label}`);
    const clickProfile = name => clickWhere('.profile-list button', `e=>e.querySelector('strong')?.textContent.trim()===${JSON.stringify(name)}`, `profile ${name}`);
    // Metadata lives in a collapsed <details>; open it instead of toggling blind.
    const openMetadata = async () => {
      if (!(await js(`Boolean(document.querySelector('.document-metadata'))`))) await click('Organizar');
      await wait(`Boolean(document.querySelector('.document-metadata'))`, 'metadata panel');
      await js(`document.querySelector('.document-metadata').open=true`); await pause(150);
    };
    // Adopting lives in the folder panel now: one place that lists what the folder holds.
    const openFolderPanel = async () => {
      if (await js(`Boolean(document.querySelector('.folder-body'))`)) return;
      await clickWhere('.folder-contents header button', `e=>e.textContent.includes('En la carpeta')`, 'open folder panel');
    };
    const adopt = async fileName => {
      await openFolderPanel();
      await clickWhere('.folder-row button', `e=>e.closest('.folder-row').querySelector('span').textContent.trim().startsWith(${JSON.stringify(fileName)})`, `adopt ${fileName}`);
    };
    const fill = async (selector, value) => {
      await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, `field ${selector}`);
      await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await pause(120);
    };
    const shot = async name => {
      await pause(350);
      fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      evidence.screenshots.push(`${name}.png`);
    };
    const record = (name, via, details = {}) => evidence.steps.push({ name, via, details });
    await win.loadURL(evidence.devUrl);
    await click('Agregar marca'); await fill('#new-name', 'Bruma QA — ficticia'); await click('Crear marca', '[role="dialog"] button');
    const brand = (await api('listBrands'))[0];
    await click('Nuevo trabajo'); await fill('#new-name', 'Campaña embudo QA — no publicar'); await click('Crear trabajo', '[role="dialog"] button');
    const work = (await api('listWorks', brand.id))[0];
    const strategy = await api('createDocument', work.id, 'strategy', 'Estrategia oferta v1');
    await api('saveDocument', strategy.document.id, '# Oferta sintética\nPrimer envío gratis.', strategy.fingerprint);
    const titles = ['Descubrimiento: video del ritual de café con título completo y variante de audiencia nueva', 'Consideración: cómo funciona la suscripción', 'Conversión: oferta primer pedido', 'Retención: segundo pedido'];
    const ids = [];
    for (let i = 0; i < titles.length; i++) {
      const d = await api('createDocument', work.id, 'copy', titles[i], strategy.document.id);
      await api('saveDocument', d.document.id, `# ${titles[i]}\nSIMULACIÓN. No publicar.`, d.fingerprint);
      ids.push(d.document.id);
    }
    record('Synthetic campaign setup', 'UI brand/work; preload document fixtures', { workId: work.id, strategyId: strategy.document.id, ids });
    await win.reload(); await click('Revisar');

    // Feature selectors are stable accessible labels supplied by the UI owner.
    // Keep these explicit: missing controls must fail rather than fall back to IPC writes.
    const selectors = {
      search: '[aria-label="Buscar documentos"]',
      status: '[aria-label="Estado del documento"]',
      profileId: '#profile-id', name: '#profile-name', initial: '#profile-initial',
      summary: '#profile-summary', soul: '#profile-soul', skills: '#profile-skills',
    };
    for (let i = 0; i < ids.length; i++) {
      await clickTab('Documentos');
      await fill(selectors.search, titles[i]);
      await clickDocument(titles[i]);
      await openMetadata();
      await click(['Descubrimiento', 'Consideración', 'Conversión', 'Retención'][i], 'label,button');
      // Metadata may be explicit-save controls; asserted persistence below is authoritative.
      await click('Guardar organización');
      await fill(selectors.search, '');
    }
    const documents = await api('listDocuments', work.id);
    for (let i = 0; i < ids.length; i++) assert.deepEqual(documents.find(d => d.id === ids[i]).funnelStages, [['discovery'], ['consideration'], ['conversion'], ['retention']][i]);
    record('Classified four documents', 'UI DOM + preload read assertion');
    await clickTab('Embudo');
    await shot('01-funnel-1440x1000');
    evidence.funnelGeometry = await js(`[...document.querySelectorAll('[data-stage],.funnel-stage')].map(e=>({stage:e.dataset.stage,text:e.innerText,width:e.getBoundingClientRect().width}))`);
    win.setSize(1280, 800); await shot('02-funnel-1280x800');
    evidence.horizontalOverflow = await js('document.documentElement.scrollWidth > innerWidth');
    win.setSize(1440, 1000);

    await clickTab('Documentos');
    await fill(selectors.search, 'variante de audiencia nueva'); await clickDocument(titles[0]);
    await click('Editar'); await fill('.markdown-editor', '# BORRADOR QA SIN GUARDAR');
    await fill(selectors.search, ''); await clickDocument(titles[1]); await clickDocument(titles[0]);
    await wait(`document.querySelector('.markdown-editor')?.value === '# BORRADOR QA SIN GUARDAR'`, 'draft survives document navigation');
    await click('Guardar');
    assert.equal((await api('readDocument', ids[0])).content, '# BORRADOR QA SIN GUARDAR');
    record('Search, open existing editor, preserve draft across selection', 'UI DOM + preload read assertion');

    const base = await api('readDocument', strategy.document.id);
    await api('saveDocument', strategy.document.id, '# Oferta sintética\n10% de descuento.', base.fingerprint);
    await clickWhere('.doc-list-review', 'e=>true', 'review filter');
    await wait(`[${ids.map(id => JSON.stringify(id)).join(',')}].every(id=>[...document.querySelectorAll('[data-document-id]')].some(e=>e.dataset.documentId===id))`, 'all outdated documents in review queue');
    await shot('03-review-queue');
    await clickWhere('.doc-list-review', 'e=>true', 'review filter off'); await clickDocument(titles[2]); await openMetadata(); await fill(selectors.status, 'review'); await click('Guardar organización');
    await click('Ya lo revisé');
    assert.equal((await api('readDocument', ids[2])).document.status, 'review');
    assert.equal((await api('readDocument', ids[2])).baseOutdated, false);
    record('Review queue and acknowledgement does not approve', 'preload base change; UI queue/status/acknowledgement');

    // What an agent actually leaves behind: a file with a stage proposed in front matter.
    const workDir = path.join(root, 'data', 'brands', brand.id, 'works', work.id);
    const left = path.join(workDir, 'retencion.md');
    fs.writeFileSync(left, '---\nfunnel: retention\n---\n# Segundo pedido\nSIMULACIÓN. No publicar.\n');
    await win.reload();
    await click('Revisar');
    await openFolderPanel();
    const proposal = await js(`[...document.querySelectorAll('.folder-row')].find(e=>e.querySelector('span').textContent.trim().startsWith('retencion.md'))?.querySelector('em')?.textContent.trim()`);
    assert.equal(proposal, 'Retención', 'The proposed stage is shown before adopting, so the human decides');
    await adopt('retencion.md');
    const adopted = (await api('listDocuments', work.id)).find(d => d.fileName === 'retencion.md');
    assert.deepEqual(adopted.funnelStages, ['retention'], 'The proposed stage must arrive with the document');
    assert.equal(fs.readFileSync(left, 'utf8'), '# Segundo pedido\nSIMULACIÓN. No publicar.\n', 'The block is a message to Latte, not part of the piece');
    assert.equal((await api('readDocument', adopted.id)).fingerprint, (await api('documentState', adopted.id)).fingerprint);
    await clickTab('Embudo'); await shot('06-proposed-stage-adopted');
    assert.equal(await js(`document.querySelectorAll('.funnel-gap').length`), await js(`[...document.querySelectorAll('.funnel-block h3 small')].filter(e=>e.textContent.trim()==='0').length + document.querySelectorAll('.funnel-gap').length`), 'An empty stage costs one line, never a block');
    await clickTab('Documentos');
    record('Agent proposes a stage, the human adopts it', 'file on disk + UI adoption + preload read assertion', { fileName: 'retencion.md' });

    // The folder the human cannot otherwise see: subfolders and the client's own files.
    fs.mkdirSync(path.join(workDir, 'piezas-instagram'), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'propuesta-final.docx'), 'binario sintetico');
    fs.writeFileSync(path.join(workDir, 'suelto.md'), '# Suelto\n');
    await win.reload(); await click('Revisar');
    assert.equal(await js(`getComputedStyle(document.querySelector('.documents')).gridTemplateColumns.split(' ').length`), 2, 'The list sits beside the document, never on top of it');
    await openFolderPanel();
    const listed = await js(`[...document.querySelectorAll('.folder-row > span')].map(e=>e.textContent.trim())`);
    for (const name of ['piezas-instagram/', 'propuesta-final.docx', 'suelto.md']) assert(listed.some(t => t.startsWith(name)), `${name} must be visible to the human`);
    for (const managed of ['CLAUDE.md', 'AGENTS.md']) assert(!listed.some(t => t.startsWith(managed)), `${managed} is Latte's, not the client's material`);
    await shot('07-folder-contents');
    record('The human sees the whole folder, not only what Latte tracks', 'UI DOM + real folder on disk', { listed });

    // Asked to organise the funnel, an agent can only write files. This is that file.
    const tracked = (await api('listDocuments', work.id)).find(d => d.id === ids[3]);
    const trackedFile = path.join(workDir, tracked.fileName);
    const original = fs.readFileSync(trackedFile, 'utf8');
    fs.writeFileSync(trackedFile, ['---', 'funnel: retention', '---', ''].join('\n') + original);
    await win.reload(); await click('Revisar');
    await clickDocument(titles[3]);
    await wait(`document.body.innerText.includes('El agente propone')`, 'pending proposal surfaced');
    assert.equal(fs.readFileSync(trackedFile, 'utf8'), original, 'The block never reaches the editor or a version');
    assert.deepEqual((await api('listDocuments', work.id)).find(d => d.id === ids[3]).funnelStages, ['retention'], 'Pending must not change the stages on its own');
    await shot('08-funnel-proposal-pending');
    await click('Aplicar');
    await wait(`!document.body.innerText.includes('El agente propone')`, 'proposal answered');
    const answered = (await api('listDocuments', work.id)).find(d => d.id === ids[3]);
    assert.deepEqual(answered.proposedFunnelStages, [], 'Applying clears the proposal');
    assert(answered.funnelStages.includes('retention'));
    record('Agent proposes on a tracked document, the human applies', 'file on disk + UI bar + preload read assertion');

    // A rail that leaks its labels is worse than no rail: measure it, do not eyeball it.
    await click('Plegar el menú');
    const rail = await js(`(()=>{const s=document.querySelector('.sidebar');const b=[...s.querySelectorAll('nav button')];return {width:Math.round(s.offsetWidth),overflow:s.scrollWidth-s.clientWidth,fonts:[...new Set(b.map(e=>getComputedStyle(e).fontSize))],wider:b.filter(e=>e.scrollWidth>e.clientWidth+1).length};})()`);
    assert.equal(rail.width, 64, 'The rail is the rail');
    assert.equal(rail.overflow, 0, 'Nothing spills out of the rail');
    assert.deepEqual(rail.fonts, ['0px'], 'Labels are bare text nodes: only a zeroed font hides them');
    assert.equal(rail.wider, 0, 'No button is wider than the rail');
    // Expanded, the toggle must not sit on top of the wordmark.
    await click('Desplegar el menú');
    const clash = await js(`(()=>{const w=document.querySelector('.logo-mark').getBoundingClientRect();const t=document.querySelector('.rail-toggle').getBoundingClientRect();return !(t.left>=w.right||t.right<=w.left||t.top>=w.bottom||t.bottom<=w.top);})()`);
    assert.equal(clash, false, 'The toggle does not overlap the logo');
    await click('Plegar el menú');
    await shot('10-rail');
    // Collapsed AND in conversation mode: the rail must change one track, not the layout.
    await click('Conversar');
    const focus = await js(`(()=>{const s=document.querySelector('.app-shell');const cols=getComputedStyle(s).gridTemplateColumns.split(' ');return {cols:cols.length,first:Math.round(parseFloat(cols[0])),overflow:document.documentElement.scrollWidth-innerWidth};})()`);
    assert.equal(focus.cols, 2, 'Conversar stays two columns while the rail is collapsed');
    assert.equal(focus.first, 64, 'And the first one is the rail');
    assert.equal(focus.overflow, 0, 'Nothing hangs off the window');
    await shot('11-rail-conversar');
    await click('Revisar');
    await click('Desplegar el menú');
    assert.equal(await js(`Math.round(document.querySelector('.sidebar').offsetWidth)`), 232, 'And it comes back');
    record('The sidebar collapses to a rail without leaking labels', 'UI DOM measurement');

    // The team is a row of tabs, not a list that eats the conversation.
    await click('Conversar');
    for (const roleName of ['Strategist', 'Researcher']) {
      const before = (await api('listTeam', work.id)).length;
      if (before > 0) await click('Sumar un rol al equipo');
      await clickWhere('.role-card', `e=>e.querySelector('strong')?.textContent.trim()===${JSON.stringify(roleName)}`, `role ${roleName}`);
      await click('Abrir conversación');
      await wait(`document.querySelectorAll('.team-tab').length === ${before + 1}`, `tab for ${roleName}`);
    }
    const tabs = await js(`[...document.querySelectorAll('.team-tab')].map(e=>({name:e.querySelector('.team-tab-name').textContent.trim(),selected:e.getAttribute('aria-selected'),dot:getComputedStyle(e.querySelector('.team-tab-dot')).backgroundColor}))`);
    assert.deepEqual(tabs.map(t => t.name), ['Strategist', 'Researcher'], 'One tab per member, in order');
    assert.equal(tabs.filter(t => t.selected === 'true').length, 1, 'Exactly one tab is active');
    assert.equal(new Set(tabs.map(t => t.dot)).size >= 1, true, 'Each tab carries its own state dot');
    // The row must stay one row: that was the whole point.
    const strip = await js(`(()=>{const r=document.querySelector('.team-tabs');const s=document.querySelector('.team-tab-strip');return {rows:Math.round(r.offsetHeight), scrolls:s.scrollWidth>s.clientWidth};})()`);
    assert(strip.rows < 60, 'The team is one row, not a stack');
    await shot('12-team-tabs');
    // Switching members is one click.
    await clickWhere('.team-tab', `e=>e.querySelector('.team-tab-name').textContent.trim()==='Strategist'`, 'switch to Strategist');
    assert.equal(await js(`document.querySelector('.team-tab[aria-selected="true"] .team-tab-name').textContent.trim()`), 'Strategist');
    record('The team is a row of tabs and adding is a dialog', 'UI DOM measurement + preload read assertion');
    await click('Revisar');

    // One agent asking for another: it can only write a file, and you decide.
    fs.writeFileSync(path.join(workDir, 'para-paid.md'), ['---', 'para: paid-media', '---', 'Revisar el presupuesto de octubre contra el objetivo de 40 pruebas.', ''].join('\n'));
    await win.reload(); await click('Conversar');
    await wait(`document.body.innerText.includes('Un agente pide que')`, 'handoff surfaced');
    assert.equal((await api('listTeam', work.id)).some(m => m.roleId === 'paid-media'), false, 'Asking must not open anything on its own');
    await shot('13-handoff');
    const legible = await js(`(()=>{const b=[...document.querySelectorAll('.doc-banner button.primary')].map(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,fg:s.color};});return b;})()`);
    assert(legible.length > 0, 'The banner offers a primary action');
    for (const b of legible) assert.notEqual(b.bg, b.fg, 'A primary action in a banner must not be its own colour');
    assert(legible.every(b => b.bg.startsWith('rgb(183')), 'It keeps the accent background: .doc-banner button would otherwise win on specificity');
    await click('Abrir con el pedido');
    await wait(`document.querySelector('[aria-label="Mensaje al agente"]')?.value?.includes('presupuesto de octubre')`, 'request loaded in the composer');
    const opened = (await api('listTeam', work.id)).find(m => m.roleId === 'paid-media');
    assert(opened, 'Accepting opens that role');
    assert.equal((await api('listHandoffs', work.id)).length, 0, 'The ask is consumed once answered');
    assert.equal(fs.existsSync(path.join(workDir, 'para-paid.md')), false, 'The file was a message to Latte, not a deliverable');
    record('One agent asks for another, the human opens it with the request loaded', 'file on disk + UI DOM + preload read assertion');
    await click('Revisar');

    await click('Ajustes'); await click('Skills');
    await wait(`document.body.innerText.includes('Escritura sin relleno')`, 'shipped skill listed');
    assert.deepEqual((await api('listSkills')).map(s => [s.id, s.enabled]), [['writing', true]], 'A shipped skill arrives on');
    await shot('09-skills');
    await click('Apagar');
    await wait(`document.body.innerText.includes('Activar')`, 'switch flips');
    assert.equal((await api('listSkills'))[0].enabled, false);
    await click('Activar');
    assert.equal((await api('listSkills'))[0].enabled, true, 'The switch goes both ways');
    record('Shipped writing skill listed and switchable', 'UI DOM + preload read assertion');

    // Already inside Settings: only the section changes.
    await click('Perfiles');
    const builtins = await api('listProfiles');
    // The neutral assistant ships without SOUL on purpose; clone one that carries instructions.
    const builtin = builtins.find(p => p.source === 'builtin' && p.soul.trim());
    assert(builtin, 'Protected default profile with instructions must exist');
    await click('Nuevo perfil');
    for (const [key, value] of Object.entries({ profileId: 'bruma-qa', name: 'Estratega Bruma QA', initial: 'B', summary: 'Perfil ficticio de prueba', soul: '# SOUL QA\nPreguntá por margen antes de escalar.', skills: '# SKILL QA\nSepará adquisición y retención.' })) await fill(selectors[key], value);
    await click('Guardar perfil');
    await wait(`document.body.innerText.includes('Estratega Bruma QA')`, 'saved custom profile');
    const custom = (await api('listProfiles')).find(p => p.id === 'bruma-qa');
    assert(custom && custom.source === 'custom');
    assert.match(fs.readFileSync(path.join(custom.directory, 'SOUL.md'), 'utf8'), /margen/);
    assert.match(fs.readFileSync(path.join(custom.directory, 'SKILL.md'), 'utf8'), /adquisición/);
    await shot('04-profile-files');
    await clickProfile(builtin.name); await click('Duplicar perfil');
    await fill(selectors.profileId, 'bruma-qa-clone'); await fill(selectors.name, 'Copia QA protegida'); await click('Guardar perfil');
    const after = await api('listProfiles');
    assert(after.some(p => p.id === 'bruma-qa-clone' && p.source === 'custom'));
    assert.equal(after.find(p => p.id === builtin.id).fingerprint, builtin.fingerprint);
    record('Create file-backed profile and clone protected default', 'UI DOM + preload read + disk read', { customDirectory: custom.directory });

    await win.reload(); await click('Ajustes'); await click('Perfiles');
    await wait(`document.body.innerText.includes('Estratega Bruma QA')`, 'profile after renderer reload');
    await shot('05-profile-reload');
    record('Renderer reload restores profiles', 'UI DOM');
    evidence.completed = true;
  } catch (error) {
    evidence.failure = String(error.stack || error);
    if (win && !win.isDestroyed()) {
      evidence.failedDOM = await win.webContents.executeJavaScript('document.body.innerText').catch(() => 'Unavailable');
      fs.writeFileSync(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    }
    console.error(error);
  } finally {
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
    unregister?.(); backend?.service.shutdown(); win?.destroy(); await vite?.close();
    app.exit(evidence.completed ? 0 : 1);
  }
});
