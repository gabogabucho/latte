// Looks at the window chrome: no parasitic scrollbars in small areas, and the
// custom title bar controls are present, draggable in the right places and
// wired to the main process. Disposable data dir, no inference.
// Usage: node_modules/electron/dist/electron.exe scripts/visual-chrome.cjs
require('tsx/cjs');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const { registerIpc } = require('../electron/ipc/register.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-visual-chrome-'));
app.setPath('userData', path.join(root, 'electron-profile'));
app.commandLine.appendSwitch('disable-gpu');
const pause = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  let backend, win, unregister;
  const errors = [];
  const result = { shots: [] };
  const asked = [];
  try {
    backend = await createBackend({ dataDir: path.join(root, 'data'), emit: () => {}, emitChat: () => {}, chooseExportPath: async () => null, seedDemo: true });
    win = new BrowserWindow({ width: 1440, height: 900, show: false, titleBarStyle: 'hidden', webPreferences: { preload: path.resolve(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    win.webContents.setFrameRate(10);
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    unregister = registerIpc({ ipcMain, api: backend.service, isTrustedSender: sender => sender.id === win.webContents.id });
    ipcMain.on('latte:window', (_e, action) => asked.push(action));
    await win.loadURL('http://127.0.0.1:5173');
    await win.webContents.executeJavaScript('document.fonts.ready');
    await pause(1400);

    result.checks = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      const scrolls = (el) => el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
      // Small areas that must never grow their own scrollbar.
      const tabs = document.querySelector('.doc-tab-list');
      const context = document.querySelector('.active-context');
      const panel = document.querySelector('.agent-panel');
      const controls = [...document.querySelectorAll('.window-controls button')].map(b => b.getAttribute('aria-label'));
      const dragRegion = getComputedStyle(document.querySelector('.topbar')).getPropertyValue('-webkit-app-region');
      const buttonRegion = getComputedStyle(document.querySelector('.window-controls button')).getPropertyValue('-webkit-app-region');
      // A scrollbar with arrow buttons is what made it look like a web page.
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;width:60px;height:40px;overflow:scroll;visibility:hidden';
      probe.innerHTML = '<div style="height:400px"></div>';
      document.body.appendChild(probe);
      const barWidth = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      return {
        tabsScrollVertically: tabs ? tabs.scrollHeight > tabs.clientHeight + 1 : null,
        activeContextScrolls: scrolls(context),
        panelScrolls: scrolls(panel),
        controls,
        topbarDraggable: dragRegion.trim() === 'drag',
        controlsClickable: buttonRegion.trim() === 'no-drag',
        scrollbarWidth: barWidth,
      };
    })()`);

    result.settings = await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('Ajustes')).click();
      await pause(700);
      const main = document.querySelector('.settings-main');
      const topbar = document.querySelector('.settings-topbar');
      const before = topbar.getBoundingClientRect().top;
      // Scroll as far as anything will go, then check the bar did not move.
      window.scrollTo(0, 99999);
      if (main) main.scrollTop = 99999;
      await pause(350);
      const bodyScrolls = document.documentElement.scrollHeight > document.documentElement.clientHeight + 1;
      const emptyTail = main ? main.scrollHeight - main.clientHeight - main.scrollTop : 0;
      const result = {
        // Settings must not become a trap: the controls are there too.
        hasControls: document.querySelectorAll('.settings-topbar .window-controls button').length,
        topbarStaysPut: Math.abs(topbar.getBoundingClientRect().top - before) < 1,
        bodyScrolls,
        windowScrollY: window.scrollY,
        // A huge unreachable tail is the "scroll infinito" the user saw.
        overscrollTail: emptyTail,
      };
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('Volver al trabajo')).click();
      await pause(500);
      return result;
    })()`);

    // The buttons really talk to the main process.
    await win.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise(r => setTimeout(r, ms));
      for (const label of ['Minimizar', 'Maximizar']) {
        const b = [...document.querySelectorAll('.window-controls button')].find(x => x.getAttribute('aria-label') === label);
        if (!b) throw new Error('Missing control: ' + label);
        b.click();
        await pause(200);
      }
      return true;
    })()`);
    await pause(400);
    result.controlActions = asked;

    for (const size of [{ w: 1280, h: 800, tag: '1280x800' }, { w: 1440, h: 1000, tag: '1440x1000' }]) {
      win.setSize(size.w, size.h);
      await pause(500);
      const file = path.join(__dirname, '..', 'assets', `latte-chrome-${size.tag}.png`);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      result.shots.push(path.basename(file));
    }

    result.errors = errors;
    console.log(JSON.stringify(result, null, 2));
    const c = result.checks;
    const s2 = result.settings;
    const ok = s2.hasControls === 3 && s2.topbarStaysPut && s2.bodyScrolls === false && s2.windowScrollY === 0 && s2.overscrollTail < 4
      && c.tabsScrollVertically === false
      && c.activeContextScrolls === false
      && c.panelScrolls === false
      && c.controls.length === 3
      && c.topbarDraggable && c.controlsClickable
      && c.scrollbarWidth <= 10
      && result.controlActions.join(',') === 'minimize,maximize'
      && errors.length === 0;
    if (!ok) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  unregister?.(); backend?.service.shutdown(); win?.destroy(); app.exit(process.exitCode || 0);
});
