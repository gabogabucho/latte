// Read-only UI smoke capture in an isolated, hidden Electron window. No build.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'latte-visual-qa-')));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  try {
    await window.loadURL('http://127.0.0.1:5173');
    await window.webContents.executeJavaScript('document.fonts.ready');
    await new Promise(resolve => setTimeout(resolve, 900));
    fs.writeFileSync(path.join(__dirname, '../assets/latte-mvp-desktop.png'), (await window.webContents.capturePage()).toPNG());
    const result = await window.webContents.executeJavaScript(`(() => {
      const body = document.body.innerText;
      return { title: document.title, hasBrand: body.includes('Casa Oliva'), hasBrief: body.includes('Una nueva forma de habitar'), hasMemory: body.includes('Memoria'), noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth, buttons: document.querySelectorAll('button').length, desktop: !!window.latte };
    })()`);
    const workflow = await window.webContents.executeJavaScript(`(async () => {
      const pause = () => new Promise(r => setTimeout(r, 130));
      const click = async text => { const b = [...(document.querySelector('[role=dialog]') || document).querySelectorAll('button')].find(b => b.textContent.trim() === text); if (!b || b.disabled) throw new Error('Button unavailable: ' + text); b.click(); await pause(); };
      const value = async (selector, text) => { const input = document.querySelector(selector); if (!input) throw new Error('Missing: ' + selector); const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); };
      await click('Agregar marca'); await value('#new-name', 'Marca QA'); await click('Crear marca');
      await click('Nuevo trabajo'); await value('#new-name', 'Campaña QA'); await click('Crear trabajo');
      await click('Editar'); await value('[aria-label="Editar brief en Markdown"]', '# Brief QA\\n\\nUna propuesta verificable.'); await click('Guardar cambios'); await click('Conservar versión');
      await click('Decisiones 0'); await value('[aria-label="Nueva decisión"]', 'Elegimos una audiencia por evidencia documentada.'); await click('Registrar decisión');
      await click('Contexto'); await value('#brand-context', 'Contexto QA persistente'); await click('Guardar contexto');
      const store = JSON.parse(localStorage.getItem('latte-preview-v1'));
      const brand = store.brands.find(b => b.name === 'Marca QA');
      const work = store.works.find(w => w.brandId === brand.id);
      return { brandCreated: !!brand, contextSaved: brand.context === 'Contexto QA persistente', briefSaved: work.brief.includes('Brief QA'), snapshotSaved: store.revisions.some(r => r.workId === work.id && r.content.includes('Brief QA')), decisionSaved: store.decisions.some(d => d.workId === work.id), isolated: store.works.filter(w => w.brandId === 'demo').length === 1 };
    })()`);
    console.log(JSON.stringify({ ...result, workflow, errors }));
    if (!result.hasBrand || !result.hasBrief || !result.noHorizontalOverflow || errors.length || Object.values(workflow).some(v => !v)) process.exitCode = 1;
  } catch (error) { console.error(error); console.log(await window.webContents.executeJavaScript('document.body.innerText')); fs.writeFileSync(path.join(__dirname, '../assets/latte-qa-failure.png'), (await window.webContents.capturePage()).toPNG()); process.exitCode = 1; }
  window.destroy(); app.exit(process.exitCode || 0);
});
