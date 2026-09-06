'use strict';
// Runtime probe: prints what the Electron main process actually supports.
// Run with: npm run probe:electron  (opens no window, exits by itself)
const { app } = require('electron');

function probe(label, fn) {
  try {
    const value = fn();
    return { label, ok: true, value };
  } catch (error) {
    return { label, ok: false, value: error && error.message ? error.message.split('\n')[0] : String(error) };
  }
}

app.whenReady().then(() => {
  const results = [
    probe('electron', () => process.versions.electron),
    probe('node', () => process.versions.node),
    probe('node:sqlite', () => {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(':memory:');
      const row = db.prepare('select sqlite_version() as v').get();
      db.close();
      return `sqlite ${row.v}`;
    }),
    probe('node-pty', () => {
      const pty = require('node-pty');
      return typeof pty.spawn === 'function' ? 'loaded' : 'missing spawn';
    }),
    probe('sql.js', () => (require('sql.js') ? 'loaded' : 'missing')),
    probe('tsx/cjs', () => (require.resolve('tsx/cjs') ? 'resolvable' : 'missing')),
  ];
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.label}: ${r.value}`);
  app.quit();
});
