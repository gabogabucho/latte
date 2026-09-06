// Dev orchestrator: starts the Vite dev server in-process, then launches
// Electron pointing at it. No bundling of the main process happens anywhere.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

// strictPort off here: if another Vite already holds 5173, take the next free
// port and point Electron at whatever we actually got.
const server = await createServer({ configFile: 'vite.config.ts', server: { strictPort: false } });
await server.listen();

const address = server.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : 5173;
const url = `http://127.0.0.1:${port}`;
server.printUrls();

const child = spawn(electronBinary, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
  windowsHide: false,
});

const startedAt = Date.now();
const shutdown = async (code = 0) => {
  await server.close();
  process.exit(code);
};

// Electron failing to start is the one case that used to be invisible: Vite
// stayed up, no window appeared and nothing was printed.
child.on('error', async (error) => {
  console.error('');
  console.error(`[latte] No se pudo iniciar Electron: ${error.message}`);
  console.error('[latte] Probá "npm ci" de nuevo; el binario de Electron se baja durante la instalación.');
  console.error('');
  await shutdown(1);
});

child.on('exit', async (code) => {
  const quickExit = Date.now() - startedAt < 4000 && code !== 0;
  if (quickExit) {
    console.error('');
    console.error(`[latte] Electron se cerró enseguida (código ${code}) y no se abrió ninguna ventana.`);
    console.error('[latte] Causa más común: ya hay otra instancia de Latte abierta (solo se permite una).');
    console.error('[latte] Cerrala y volvé a correr "npm run dev".');
    console.error('');
  }
  await shutdown(quickExit ? 1 : 0);
});
process.on('SIGINT', () => { child.kill(); void shutdown(); });
process.on('SIGTERM', () => { child.kill(); void shutdown(); });
