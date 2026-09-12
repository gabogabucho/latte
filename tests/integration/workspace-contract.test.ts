import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackend, type Backend } from '../../electron/bootstrap';

const resources: { root: string; backend: Backend }[] = [];
// The real temp root: macOS hands out /var/folders/... where /var is a symlink to /private/var, and
// TEMP may point at a junction on Windows. The backend reports real paths, so the fixture uses them too.
const tmpRoot = fs.realpathSync(os.tmpdir());
async function fixture() {
  const root = fs.mkdtempSync(path.join(tmpRoot, 'latte-contract-'));
  const exported = path.join(root, 'exported.md');
  const backend = await createBackend({ dataDir: root, version: '0.0.0-test', seedDemo: false, driver: 'sqljs', emit: () => {}, chooseExportPath: async () => exported });
  resources.push({ root, backend });
  return { root, exported, backend, api: backend.service };
}
afterEach(() => { for (const { root, backend } of resources.splice(0)) { backend.service.shutdown(); const relative = path.relative(tmpRoot, root); if (relative.startsWith('latte-contract-') && !relative.includes(path.sep)) fs.rmSync(root, { recursive: true, force: true }); } });

describe('Latte UI/backend deliverable contract', () => {
  it('snapshots and exports exactly the brief saved through the UI API', async () => {
    const { api, exported } = await fixture();
    const b = await api.createBrand('Marca de prueba');
    const w = await api.createWork(b.id, 'Campaña de prueba');
    await api.saveBrief(w.id, '# Mensaje aprobado\n\nVersión humana.');
    const snapshot = await api.snapshot(w.id);
    expect(snapshot.content).toBe('# Mensaje aprobado\n\nVersión humana.');
    await api.exportWork(w.id);
    expect(fs.readFileSync(exported, 'utf8')).toBe(snapshot.content);
  });
  it('refresh reads agent changes from brief.md and old snapshots stay unchanged', async () => {
    const { api, backend } = await fixture();
    const b = await api.createBrand('Marca');
    const w = await api.createWork(b.id, 'Investigación');
    await api.saveBrief(w.id, '# Antes');
    const snapshot = await api.snapshot(w.id);
    fs.writeFileSync(path.join(backend.files.workDir(b.id, w.id), 'brief.md'), '# Cambiado por agente');
    expect((await api.listWorks(b.id)).find(x => x.id === w.id)?.brief).toBe('# Cambiado por agente');
    expect((await api.listRevisions(w.id)).find(x => x.id === snapshot.id)?.content).toBe('# Antes');
  });
  it('does not fall back to obsolete content when an intentionally blank brief is exported', async () => {
    const { api, exported } = await fixture();
    const b = await api.createBrand('Marca');
    const w = await api.createWork(b.id, 'Brief');
    await api.saveBrief(w.id, '# Viejo'); await api.snapshot(w.id);
    await api.saveBrief(w.id, ''); await api.exportWork(w.id);
    expect(fs.readFileSync(exported, 'utf8')).toBe('');
  });
  it('keeps different brands isolated and refuses traversal identifiers', async () => {
    const { api } = await fixture();
    const a = await api.createBrand('Primera'), b = await api.createBrand('Segunda');
    const w = await api.createWork(a.id, 'Trabajo A');
    await api.addDecision(w.id, 'Una decisión privada de A');
    expect(await api.listWorks(b.id)).toEqual([]);
    await expect(api.saveBrief('../escape', 'bad')).rejects.toThrow();
    await expect(api.listWorks('C:\\outside')).rejects.toThrow();
    await expect(api.startAgent(w.id, 'powershell' as never)).rejects.toThrow();
  });
  it('reopening the database preserves brand context, brief and decisions', async () => {
    const { api, root, backend } = await fixture();
    const b = await api.createBrand('Persistente'); const w = await api.createWork(b.id, 'Trabajo');
    await api.updateBrand(b.id, 'Tono preciso'); await api.saveBrief(w.id, '# Persistente'); await api.addDecision(w.id, 'Decisión durable');
    backend.service.shutdown(); resources.splice(resources.findIndex(r => r.backend === backend), 1);
    const reopened = await createBackend({ dataDir: root, version: '0.0.0-test', seedDemo: false, driver: 'sqljs', emit: () => {}, chooseExportPath: async () => null });
    resources.push({ root, backend: reopened });
    expect((await reopened.service.listBrands())[0].context).toBe('Tono preciso');
    expect((await reopened.service.listWorks(b.id))[0].brief).toBe('# Persistente');
    expect((await reopened.service.listDecisions(w.id))[0].text).toBe('Decisión durable');
  });
});
