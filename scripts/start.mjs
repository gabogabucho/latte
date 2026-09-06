// Launches Latte against the compiled renderer (dist/), with no dev server.
//
// What "compiled" means here: `npm run build` compiles the RENDERER only.
// The Electron main process still runs TypeScript at runtime through tsx
// (electron/main.cjs), exactly as in dev. This is a source distribution, not
// a packaged application: there is no installer and no signed binary.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexFile = path.join(root, 'dist', 'index.html');

if (!fs.existsSync(indexFile)) {
  process.stderr.write(
    [
      '',
      'Latte: falta el renderer compilado.',
      '',
      `  No existe ${path.relative(root, indexFile)}`,
      '',
      'Compilalo primero:',
      '',
      '  npm run build',
      '  npm start',
      '',
      'O usá el modo desarrollo, que no necesita compilar nada:',
      '',
      '  npm run dev',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

// No VITE_DEV_SERVER_URL: main.ts then loads dist/index.html from disk.
const { VITE_DEV_SERVER_URL, ...env } = process.env;
const child = spawn(require('electron'), ['.'], { cwd: root, stdio: 'inherit', env, windowsHide: false });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
