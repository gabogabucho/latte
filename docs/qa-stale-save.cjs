// Reproduce UI's snapshot sequence in a disposable workspace. No inference.
require('tsx/cjs');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createBackend } = require('../electron/bootstrap.ts');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-save-review-'));
  const backend = await createBackend({ dataDir: root, seedDemo: false, driver: 'sqljs', emit: () => {}, chooseExportPath: async () => null });
  try {
    const brand = await backend.service.createBrand('QA'), work = await backend.service.createWork(brand.id, 'Plan');
    await backend.service.saveBrief(work.id, '# Draft original');
    const file = path.join(backend.files.workDir(brand.id, work.id), 'brief.md');
    fs.writeFileSync(file, '# Agent strategy improved');
    // App.snapshot() unconditionally calls save() before api.snapshot().
    await backend.service.saveBrief(work.id, '# Draft original');
    const revision = await backend.service.snapshot(work.id);
    const result = { scenario: 'UI snapshot saves stale draft first', agentChangesRetained: fs.readFileSync(file, 'utf8').includes('Agent strategy improved'), snapshotContent: revision.content, revisions: (await backend.service.listRevisions(work.id)).length };
    fs.writeFileSync(path.join(__dirname, 'qa-stale-save-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { backend.service.shutdown(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
