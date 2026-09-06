import { beforeEach, describe, expect, it, vi } from 'vitest';

const data = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
vi.stubGlobal('window', {});
const { browserAPI: api } = await import('./browser-api');

beforeEach(() => data.clear());
describe('explicit browser preview', () => {
  it('keeps brand workspaces isolated', async () => {
    const a = await api.createBrand('Uno');
    const b = await api.createBrand('Dos');
    await api.createWork(a.id, 'Campaña A');
    expect(await api.listWorks(b.id)).toEqual([]);
    expect((await api.listWorks(a.id))[0].title).toBe('Campaña A');
  });
  it('preserves immutable snapshots after editing the brief', async () => {
    const b = await api.createBrand('Marca');
    const w = await api.createWork(b.id, 'Brief');
    await api.saveBrief(w.id, '# Primera versión');
    const snapshot = await api.snapshot(w.id);
    await api.saveBrief(w.id, '# Segunda versión');
    expect(snapshot.content).toBe('# Primera versión');
    expect((await api.listRevisions(w.id))[0].content).toBe('# Primera versión');
    expect((await api.listWorks(b.id))[0].brief).toBe('# Segunda versión');
  });
  it('persists context and scoped decisions', async () => {
    const b = await api.createBrand('Marca');
    await api.updateBrand(b.id, 'Tono cercano');
    const a = await api.createWork(b.id, 'Uno');
    const other = await api.createWork(b.id, 'Dos');
    await api.addDecision(a.id, 'Elegimos A por evidencia B');
    expect((await api.listBrands()).find(x => x.id === b.id)?.context).toBe('Tono cercano');
    expect(await api.listDecisions(other.id)).toEqual([]);
    expect(await api.listDecisions(a.id)).toHaveLength(1);
  });
  it('does not pretend to run an agent or memory server', async () => {
    expect((await api.runtimeStatus()).every(r => !r.available)).toBe(true);
    await expect(api.startAgent('demo-work', 'claude')).rejects.toThrow('escritorio');
    expect((await api.readMemory('demo')).available).toBe(false);
  });
});
