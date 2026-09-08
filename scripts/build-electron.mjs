// Compiles the Electron main process for distribution.
//
// In development electron/main.cjs registers tsx and runs TypeScript straight
// from source. tsx is a development dependency, so a packaged app cannot rely
// on it: this bundles electron/main.ts into a single CommonJS file that
// Electron loads with no compiler in the picture.
//
// electron-builder points the packaged `main` at dist-electron/main.cjs
// through `extraMetadata`, which leaves the development entry untouched.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-electron');

// Left as real require() calls at runtime:
// - electron          the runtime provides it.
// - node-pty          native addon; loaded from app.asar.unpacked.
// - sql.js            ships a WebAssembly file next to its JavaScript.
// - electron-updater   resolved optionally, so a build without it still runs.
const external = ['electron', 'node-pty', 'sql.js', 'electron-updater'];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'electron', 'main.ts')],
  outfile: path.join(outDir, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // Electron 44 runs a modern Node; nothing here needs downlevelling.
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'info',
});

// The preload is already plain CommonJS and runs in a sandboxed world with a
// single `require('electron')`. It is copied, not bundled, so what ships is
// byte for byte what tests/backend/ipc.test.ts reads.
fs.copyFileSync(path.join(root, 'electron', 'preload.cjs'), path.join(outDir, 'preload.cjs'));

console.log(`[latte] main process bundled into ${path.relative(root, outDir)}`);
