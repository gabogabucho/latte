import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import type { AgentEvent, ChatEvent } from '../shared/contracts';
import { createBackend, type Backend } from './bootstrap';
import { AGENT_EVENT_CHANNEL, CHAT_EVENT_CHANNEL } from './ipc/channels';
import { registerIpc } from './ipc/register';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? null;
const PRELOAD = path.join(__dirname, 'preload.cjs');

let mainWindow: BrowserWindow | null = null;
let backend: Backend | null = null;
let unregisterIpc: (() => void) | null = null;

app.setName('Latte');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void start();
}

async function start(): Promise<void> {
  await app.whenReady();

  const dataDir = process.env.LATTE_DATA_DIR ?? path.join(app.getPath('userData'), 'data');
  backend = await createBackend({
    dataDir,
    emit: emitAgentEvent,
    emitChat: emitChatEvent,
    chooseExportPath,
    openExternal: async (url) => { if (isExternalHttp(url)) await shell.openExternal(url); },
    log: (line) => console.log(line.trimEnd()),
  });
  console.log(`[latte] data dir: ${backend.info.dataDir}`);
  console.log(`[latte] storage: ${backend.info.engine} (${backend.info.engineReason})`);
  if (backend.info.seeded) console.log('[latte] seeded demo brand "Casa Oliva (demo)"');
  const terminal = backend.terminal.availability();
  console.log(`[latte] terminal backend: ${terminal.available ? 'node-pty ready' : `unavailable (${terminal.reason})`}`);

  hardenSession();

  // Handlers must exist before the renderer loads: its first listBrands()
  // would otherwise race the registration.
  unregisterIpc = registerIpc({
    ipcMain,
    api: backend.service,
    isTrustedSender: (sender) => mainWindow !== null && !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id,
    log: (message) => console.error(message),
  });
  createWindow();
  armSmokeExit();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'Latte',
    backgroundColor: '#f5f0e8',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // The renderer never opens windows or navigates away. External http(s)
  // links go to the system browser; everything else is dropped.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttp(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedDocument(url)) return;
    event.preventDefault();
    if (isExternalHttp(url)) void shell.openExternal(url);
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
}

/**
 * Dev/CI smoke: LATTE_SMOKE_EXIT_MS=8000 runs the real app (main + preload +
 * renderer) for that long, prints renderer console errors and exits 0/1.
 */
function armSmokeExit(): void {
  const ms = Number(process.env.LATTE_SMOKE_EXIT_MS ?? '');
  if (!Number.isFinite(ms) || ms <= 0 || !mainWindow) return;
  const errors: string[] = [];
  let loaded = false;
  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message);
  });
  mainWindow.webContents.on('did-finish-load', () => { loaded = true; });
  mainWindow.webContents.on('did-fail-load', (_e, code, description) => errors.push(`did-fail-load ${code} ${description}`));
  setTimeout(() => {
    console.log(`[latte:smoke] renderer loaded=${loaded} consoleErrors=${errors.length}`);
    for (const error of errors) console.log(`[latte:smoke] error: ${error.slice(0, 300)}`);
    process.exitCode = loaded && errors.length === 0 ? 0 : 1;
    app.quit();
  }, ms);
}

function hardenSession(): void {
  const ses = session.defaultSession;

  // Deny everything by default; copying terminal output is the one thing we allow.
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });
  ses.setPermissionCheckHandler((_webContents, permission) => permission === 'clipboard-sanitized-write');

  const csp = buildCsp();
  ses.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function buildCsp(): string {
  if (DEV_SERVER_URL) {
    const origin = new URL(DEV_SERVER_URL).origin;
    const ws = origin.replace(/^http/, 'ws');
    // Vite's dev client and the React fast-refresh preamble are inline scripts;
    // this relaxed policy exists only in development.
    return [
      `default-src 'self' ${origin}`,
      `script-src 'self' 'unsafe-inline' ${origin}`,
      `style-src 'self' 'unsafe-inline' ${origin}`,
      `img-src 'self' data: blob: ${origin}`,
      `font-src 'self' data: ${origin}`,
      `connect-src 'self' ${origin} ${ws}`,
      "object-src 'none'",
      "base-uri 'none'",
      "frame-src 'none'",
    ].join('; ');
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join('; ');
}

function isExternalHttp(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !DEV_SERVER_URL || parsed.origin !== new URL(DEV_SERVER_URL).origin;
  } catch {
    return false;
  }
}

function isAllowedDocument(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (DEV_SERVER_URL) return parsed.origin === new URL(DEV_SERVER_URL).origin;
    return parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

function emitAgentEvent(event: AgentEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(AGENT_EVENT_CHANNEL, event);
}

function emitChatEvent(event: ChatEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(CHAT_EVENT_CHANNEL, event);
}

async function chooseExportPath(suggestedFileName: string): Promise<string | null> {
  const options = {
    title: 'Export deliverable',
    defaultPath: path.join(app.getPath('documents'), suggestedFileName),
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  unregisterIpc?.();
  unregisterIpc = null;
  backend?.service.shutdown();
  backend = null;
});
