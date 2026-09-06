// A real session, driven through the UI the way a person would: clicks, typing,
// a real agent conversation and a screenshot at every step. Not a smoke test:
// there are no assertions. The point is to live the flow and write down where
// it hurts.
//
// It DOES use inference on the user's own Claude Code subscription, once, and
// only because the user asked for a real run.
//
// Usage: node_modules/electron/dist/electron.exe scripts/pilot.cjs
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const { attachCloseGuard } = require('../electron/windowClose.ts');

const DATA_DIR = process.env.LATTE_DATA_DIR;
const SHOTS = process.env.PILOT_SHOTS;
const EXPORT_TO = process.env.PILOT_EXPORT || null;
const pause = (ms) => new Promise(r => setTimeout(r, ms));
app.setPath('userData', path.join(path.dirname(DATA_DIR), 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');

const notes = [];
const note = (what) => { notes.push(what); console.log(`  · ${what}`); };

app.whenReady().then(async () => {
  let backend, win, unregister;
  const errors = [];
  const log = {};
  try {
    win = new BrowserWindow({ width: 1440, height: 950, show: false, titleBarStyle: 'hidden', webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    backend = await createBackend({
      dataDir: DATA_DIR,
      emit: e => win.webContents.send('latte:agent-event', e),
      emitChat: e => win.webContents.send('latte:chat-event', e),
      chooseExportPath: async () => EXPORT_TO,
      chooseFolder: async () => null,
      seedDemo: false,
    });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    ipcMain.on('latte:unsaved', () => {});
    ipcMain.on('latte:window', () => {});
    attachCloseGuard(win, { hasUnsavedWork: () => false, confirm: () => true });
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    await pause(1500);

    const run = (script) => win.webContents.executeJavaScript(script);
    let shotIndex = 0;
    const shot = async (name) => {
      await pause(600);
      shotIndex += 1;
      fs.writeFileSync(path.join(SHOTS, `${String(shotIndex).padStart(2, '0')}-${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    // Helpers that behave like a person: find by visible text, type into fields.
    const helpers = `
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const byText = (text, selector) => [...document.querySelectorAll(selector || 'button')].find(b => b.textContent.includes(text));
      const click = async (text, selector) => { const b = byText(text, selector); if (!b) throw new Error('No encuentro: ' + text); if (b.disabled) throw new Error('Deshabilitado: ' + text); b.click(); await pause(400); };
      const clickWhenEnabled = async (text, selector) => { for (let i = 0; i < 240; i++) { const b = byText(text, selector); if (b && !b.disabled) { b.click(); await pause(400); return; } await pause(250); } throw new Error('Nunca se habilitó: ' + text); };
      const type = async (selector, value) => { const el = document.querySelector(selector); if (!el) throw new Error('No encuentro campo: ' + selector); const proto = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); await pause(250); };
      const screen = () => document.body.innerText.split(String.fromCharCode(10)).map(l => l.trim()).filter(Boolean).join(' | ');
    `;
    const act = (body) => run(`(async () => {${helpers}${body}})()`);

    // ---------------------------------------------------------------- 1. marca
    console.log('1. Crear la marca y cargar su contexto');
    log.brand = await act(`
      await click('Agregar marca');
      await type('#new-name', 'Tierra Fina');
      await click('Crear marca');
      await click('Contexto');
      await type('#brand-context', ${JSON.stringify(BRAND_CONTEXT)});
      await click('Guardar contexto');
      return { screen: screen().slice(0, 200) };
    `);
    await shot('marca-contexto');

    // ----------------------------------------------------------- 2. el trabajo
    console.log('2. Crear el trabajo y escribir el encargo');
    log.work = await act(`
      await click('Nuevo trabajo');
      await type('#new-name', 'Lanzamiento en redes');
      await click('Crear trabajo');
      await click('Editar');
      await type('[aria-label="Editar documento en Markdown"]', ${JSON.stringify(BRIEF)});
      await click('Guardar');
      await pause(600);
      return { screen: screen().slice(0, 260) };
    `);
    await shot('encargo');

    // ------------------------------------------- 3. el agente hace la estrategia
    console.log('3. Sumar un Strategist sobre Claude Code y pedirle la estrategia');
    await backend.service.setPrimaryAgent({ runtime: 'claude', model: null, accountId: 'system' });
    log.member = await act(`
      // Con el equipo vacío el selector ya está abierto; con miembros hay que pedirlo.
      if (byText('Sumar un rol')) await click('Sumar un rol');
      await click('Strategist', '.role-card');
      await clickWhenEnabled('Abrir conversación');
      return { screen: screen().slice(0, 200) };
    `);
    await shot('equipo-strategist');

    console.log('   enviando el pedido al agente (usa tu cuenta de Claude Code)…');
    await act(`
      await type('[aria-label="Mensaje al agente"]', ${JSON.stringify(ASK)});
      await pause(300);
      const send = document.querySelector('[aria-label="Enviar mensaje"]');
      if (!send || send.disabled) throw new Error('No puedo enviar el mensaje');
      send.click();
    `);
    // A real answer takes a while; watch for it instead of guessing.
    const waited = Date.now();
    let seen = { permissions: 0, done: false };
    for (let i = 0; i < 300; i += 1) {
      await pause(2000);
      const state = await run(`(() => ({
        permission: Boolean(document.querySelector('.chat-card.permission')),
        working: Boolean(document.querySelector('.chat-status')),
        text: (document.querySelector('.chat-scroll')?.innerText ?? '').slice(-600),
        editing: Boolean(document.querySelector('.doc-editing')),
        untracked: (document.querySelector('.doc-banner.untracked')?.innerText ?? '').trim(),
      }))()`);
      if (state.permission) {
        seen.permissions += 1;
        note(`El agente pidió permiso; lo aprobé desde la tarjeta (${seen.permissions})`);
        await shot('permiso');
        await act(`await click('Permitir siempre', '.chat-card.permission button');`);
        continue;
      }
      if (state.editing) note('Se ve el punto de "está escribiendo" en la pestaña del documento');
      if (state.untracked) { log.untrackedBanner = state.untracked; note('Latte ofreció adoptar un archivo que creó el agente'); }
      if (!state.working && i > 2) { seen.done = true; log.reply = state.text; break; }
    }
    log.agentSeconds = Math.round((Date.now() - waited) / 1000);
    await shot('respuesta-agente');

    // ------------------------------------------------ 4. qué quedó en el trabajo
    const brand = (await backend.service.listBrands()).find(b => b.name === 'Tierra Fina');
    const workNow = (await backend.service.listWorks(brand.id))[0];
    const hasStrategy = (await backend.service.listDocuments(workNow.id)).some(d => d.kind === 'strategy');
    if (!hasStrategy) {
      note('El agente respondió en el chat sin crear el archivo: uso "Guardar como documento"');
      win.webContents.executeJavaScript('window.prompt = () => "Estrategia de redes"');
      log.savedFromChat = await act(`
        const save = byText('Guardar como documento');
        if (!save) return { ok: false, why: 'no apareció el botón' };
        save.click();
        await pause(1500);
        return { ok: true, screen: screen().slice(0, 160) };
      `);
      await shot('guardado-desde-chat');
    } else {
      note('El agente creó el documento por su cuenta');
    }
    const work = workNow;
    log.documentsAfterAgent = (await backend.service.listDocuments(work.id)).map(d => [d.kind, d.fileName, d.title]);
    log.untrackedAfterAgent = (await backend.service.listUntrackedFiles(work.id)).map(f => f.fileName);
    log.filesOnDisk = fs.readdirSync(backend.files.workDir(brand.id, work.id));

    // ------------------------------------------- 5. adoptar, versionar, exportar
    console.log('4. Adoptar lo que dejó, versionar y exportar');
    log.adopted = await act(`
      const add = byText('Agregar ');
      if (!add) return { adopted: false, why: 'no había nada para adoptar' };
      add.click();
      await pause(1200);
      return { adopted: true, screen: screen().slice(0, 200) };
    `);
    await shot('adoptado');

    log.versions = await act(`
      await click('Conservar versión');
      await pause(600);
      await click('Versiones');
      await pause(800);
      const list = [...document.querySelectorAll('.revision-list button')].map(b => b.innerText.split(String.fromCharCode(10)).join(' ').trim());
      const close = document.querySelector('.modal-close');
      if (close) close.click();
      await pause(400);
      return { list };
    `);
    await shot('versiones');

    // --------------------------------------------- 6. calendario desde estrategia
    console.log('5. Crear el calendario derivado de la estrategia');
    log.calendar = await act(`
      await click('Documento', '.doc-add');
      await pause(600);
      await click('Calendario', '.kind-card');
      await type('#doc-title', 'Calendario de 30 días');
      const select = document.querySelector('#doc-base');
      if (select) {
        const option = [...select.options].find(o => o.textContent.toLowerCase().includes('estrategia'));
        if (option) {
          const proto = Object.getPrototypeOf(select);
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(select, option.value);
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await pause(300);
        }
      }
      await click('Crear documento');
      await pause(1200);
      return { screen: screen().slice(0, 220), baseOptions: select ? [...select.options].map(o => o.textContent) : [] };
    `);
    await shot('calendario');

    // ----------------------------------------------------- 7. decisión registrada
    console.log('6. Registrar una decisión');
    log.decision = await act(`
      await click('Decisiones');
      await pause(500);
      await type('[aria-label="Nueva decisión"]', 'Publicamos 3 veces por semana en Instagram y una newsletter quincenal: es lo que una persona sola sostiene sin bajar la calidad.');
      await click('Registrar decisión');
      await pause(700);
      return { screen: screen().slice(0, 200) };
    `);
    await shot('decision');

    // ------------------------------------------------- 8. conflicto y base vieja
    console.log('7. Provocar un cambio externo y ver el conflicto');
    const workDir = backend.files.workDir(brand.id, work.id);
    const strategyFile = (await backend.service.listDocuments(work.id)).find(d => d.kind === 'strategy');
    if (strategyFile) {
      log.conflict = await act(`
        await click('Documentos');
        await pause(500);
        await click('Estrategia', '.doc-tabs button');
        await click('Editar');
        await type('[aria-label="Editar documento en Markdown"]', '# Estrategia con un cambio mío sin guardar');
        return { screen: screen().slice(0, 120) };
      `);
      fs.writeFileSync(path.join(workDir, strategyFile.fileName), '# Estrategia cambiada por fuera mientras yo editaba\n');
      await pause(3500);
      log.conflictBanner = await run(`(document.querySelector('.doc-banner')?.innerText ?? '').trim()`);
      await shot('cambio-externo');
      log.conflictPanel = await act(`
        await click('Guardar', '.document-toolbar button');
        await pause(1000);
        return { shown: Boolean(document.querySelector('.doc-conflict')), text: (document.querySelector('.doc-conflict')?.innerText ?? '').slice(0, 200) };
      `);
      await shot('conflicto');
      await act(`await click('Guardar la mía', '.doc-conflict button'); await pause(900);`);
      log.calendarNeedsReview = await act(`
        await click('Calendario', '.doc-tabs button');
        await pause(3000);
        return (document.querySelector('.doc-banner.base')?.innerText ?? '').trim();
      `);
      await shot('base-desactualizada');
    }

    // ------------------------------------------------------------- 9. exportar
    console.log('8. Exportar el entregable');
    log.exported = await act(`
      const download = document.querySelector('[title="Exportar este documento"]');
      if (!download) return { ok: false };
      download.click();
      await pause(1200);
      return { ok: true };
    `);
    log.exportedContent = EXPORT_TO && fs.existsSync(EXPORT_TO) ? fs.readFileSync(EXPORT_TO, 'utf8').slice(0, 120) : null;

    // -------------------------------------------------------- 10. ajustes y MCP
    console.log('9. Mirar Ajustes y las herramientas');
    log.settings = await act(`
      await click('Ajustes');
      await pause(700);
      await click('Herramientas');
      for (let i = 0; i < 40 && document.querySelectorAll('.runtime-card').length === 0; i++) await pause(500);
      const cards = [...document.querySelectorAll('.tools-view .runtime-card strong')].map(s => s.textContent);
      const servers = [...document.querySelectorAll('.mcp-card strong')].map(s => s.textContent);
      return { cards, servers: servers.slice(0, 10) };
    `);
    await shot('ajustes-mcp');
    await act(`await click('Volver al trabajo'); await pause(600);`);
    await shot('final');

    log.finalDocuments = (await backend.service.listDocuments(work.id)).map(d => [d.kind, d.fileName, d.title, d.status]);
    log.finalRevisions = (await backend.service.listRevisions(work.id)).map(r => [r.source, r.content.length]);
    log.decisions = (await backend.service.listDecisions(work.id)).length;
    log.notes = notes;
    log.errors = errors;
    fs.writeFileSync(path.join(SHOTS, 'pilot-log.json'), JSON.stringify(log, null, 2));
    console.log('\n--- resumen ---');
    console.log(JSON.stringify({ documentos: log.finalDocuments, revisiones: log.finalRevisions, decisiones: log.decisions, segundosDelAgente: log.agentSeconds, erroresDeConsola: errors.length }, null, 2));
  } catch (error) {
    console.error('FALLÓ:', error && error.message ? error.message : error);
    log.notes = notes;
    log.errors = errors;
    log.failedAt = String(error && error.message ? error.message : error);
    try { fs.writeFileSync(path.join(SHOTS, 'pilot-log.json'), JSON.stringify(log, null, 2)); } catch { /* ignore */ }
    process.exitCode = 1;
  }
  unregister?.(); backend?.service.shutdown(); win?.destroy(); app.exit(process.exitCode || 0);
});

const BRAND_CONTEXT = `# Tierra Fina

Cerámica utilitaria hecha a mano en Chascomús. Piezas para usar todos los días: tazas, bowls, fuentes. Cocción a alta temperatura, esmaltes sin plomo, aptas para lavavajillas.

## A quién le hablamos
Personas de 28 a 50 que cocinan en casa, ponen la mesa con intención y prefieren pocas cosas buenas antes que muchas baratas. Compran online y en dos ferias de diseño al año.

## Posicionamiento
"Piezas para usar, no para mirar." La cerámica de autor suele venderse como objeto de vitrina; Tierra Fina se vende como algo que va al horno, al lavavajillas y a la mesa de todos los días.

## Tono
Cercano, concreto, sin solemnidad. Rioplatense con voseo. Hablamos de oficio, de barro y de cocina, no de "experiencias".

## Nunca
- Decir "artesanal" ni "único e irrepetible".
- Prometer que no se rompe.
- Comparar con marcas industriales por nombre.

## Datos duros
- Producción máxima: 120 piezas por mes, una sola persona.
- Ticket promedio actual: 32.000 pesos.
- Instagram: 1.840 seguidores, 3,1 % de engagement.
- Lista de correo: 260 suscriptores, 41 % de apertura.
- Ventas últimos 3 meses: 38, 41 y 35 piezas.
`;

const BRIEF = `# Encargo · Presencia en redes 2026

## Qué necesito
Vender de forma sostenida por Instagram y newsletter, sin depender de las dos ferias del año.

## Objetivo
Llegar a 60 piezas vendidas por mes en 3 meses, desde las 38 de hoy, sin bajar el precio.

## Restricciones
- Trabajo sola: como mucho 4 horas por semana para contenido.
- Sin presupuesto de pauta al principio.
- No puedo producir más de 120 piezas al mes.

## Qué espero como entregable
Una estrategia para redes y un calendario de 30 días que pueda ejecutar sola.
`;

const ASK = `Necesito la estrategia para redes de Tierra Fina. Leé el encargo en brief.md y el contexto de marca.

Creá un documento nuevo llamado estrategia.md con la estrategia: objetivo, audiencia, propuesta, elecciones (qué hacemos y qué dejamos afuera), restricciones, hipótesis con su evidencia, y cómo lo medimos. Usá los números reales que están en el contexto y marcá lo que sea hipótesis. No inventes datos. Importante: creá el archivo ahora con lo que tengas; si falta un dato, dejalo marcado como PENDIENTE dentro del documento en vez de esperar mi respuesta.`;
