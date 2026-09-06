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

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

child.on('exit', shutdown);
process.on('SIGINT', () => { child.kill(); void shutdown(); });
process.on('SIGTERM', () => { child.kill(); void shutdown(); });
