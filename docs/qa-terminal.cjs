// Launches the installed CLI without submitting a prompt; no paid inference.
require('tsx/cjs');
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackend } = require('../electron/bootstrap.ts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-terminal-qa-'));
app.setPath('userData', path.join(root, 'profile'));
app.whenReady().then(async () => {
  let backend;
  try {
    const events = [];
    backend = await createBackend({ dataDir: path.join(root, 'data'), seedDemo: false, chooseExportPath: async () => null, emit: e => events.push(e) });
    const b = await backend.service.createBrand('Terminal QA'); const w = await backend.service.createWork(b.id, 'No inference probe');
    const session = await backend.service.startAgent(w.id, 'opencode');
    await backend.service.resizeAgent(session.id, 100, 28);
    await new Promise(resolve => setTimeout(resolve, 4000));
    const result = { started: Boolean(session.id), outputReceived: events.some(e => e.type === 'output' && e.data.length > 0), earlyExit: events.some(e => e.type === 'exit'), errors: events.filter(e => e.type === 'error').map(e => e.data) };
    await backend.service.stopAgent(session.id);
    result.stopped = backend.terminal.list().length === 0;
    console.log(JSON.stringify(result));
    fs.writeFileSync(path.join(__dirname, 'qa-terminal-result.json'), JSON.stringify(result, null, 2));
    if (!result.started || !result.outputReceived || result.earlyExit || !result.stopped || result.errors.length) process.exitCode = 1;
  } catch (e) { console.error(e); process.exitCode = 1; }
  backend?.service.shutdown(); app.exit(process.exitCode || 0);
});
