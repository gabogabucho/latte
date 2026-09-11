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
    // No disk in a browser tab: no deliverables to list, and no file to open.
    expect((await api.listDeliverables('demo-work')).files).toEqual([]);
    await expect(api.openDeliverable('demo-work', 'propuesta.pdf')).rejects.toThrow('escritorio');
  });
  it('keeps an expected output, and refuses to link a file it cannot see', async () => {
    const b = await api.createBrand('Marca');
    const w = await api.createWork(b.id, 'Uno');
    expect((await api.updateWork(w.id, { expectedOutput: '  Un PDF con la propuesta  ' })).expectedOutput).toBe('Un PDF con la propuesta');
    expect((await api.listWorks(b.id))[0].expectedOutput).toBe('Un PDF con la propuesta');
    await expect(api.updateWork(w.id, { resultPath: 'propuesta.pdf' })).rejects.toThrow('escritorio');
    expect((await api.listWorks(b.id))[0].resultPath ?? null).toBeNull();
    await expect(api.updateWork(w.id, { brief: 'x' } as never)).rejects.toThrow();
  });
  it('clears a link only with null or empty text, like the desktop', async () => {
    const b = await api.createBrand('Marca');
    const w = await api.createWork(b.id, 'Uno');
    await api.updateWork(w.id, { expectedOutput: 'Un PDF' });
    // Falsy is not "clear": false and 0 are refused, and nothing in the patch is applied.
    for (const bad of [false, 0]) {
      await expect(api.updateWork(w.id, { expectedOutput: 'Otro', resultPath: bad } as never)).rejects.toThrow(/inválido/);
    }
    expect((await api.listWorks(b.id))[0].expectedOutput).toBe('Un PDF');
    expect((await api.updateWork(w.id, { resultPath: null })).resultPath).toBeNull();
    expect((await api.updateWork(w.id, { resultPath: '' })).resultPath).toBeNull();
  });
});

describe('marketing preview parity',()=>{
 it('shows Paid Media as a shipped profile without pretending to connect an agent', async()=>{expect((await api.listProfiles()).find(p=>p.id==='paid-media')).toMatchObject({name:'Paid Media',source:'builtin'});expect((await api.listRoles()).find(p=>p.id==='paid-media')).toMatchObject({initial:'P'});await expect(api.startAgent('demo-work','claude')).rejects.toThrow('escritorio');});
 it('keeps the Sales Copywriter profile in the web preview catalog',async()=>{expect((await api.listProfiles()).find(p=>p.id==='sales-copywriter')).toMatchObject({name:'Sales Copywriter',source:'builtin'});expect((await api.listRoles()).find(p=>p.id==='sales-copywriter')).toMatchObject({initial:'C'});});
 it('normalizes old briefs and persists metadata without altering content',async()=>{const [d]=await api.listDocuments('demo-work');expect(d.funnelStages).toEqual([]);const before=await api.readDocument(d.id);await api.updateDocument(d.id,{title:'Oferta',funnelStages:['conversion','conversion'],status:'review'});expect((await api.listDocuments('demo-work'))[0]).toMatchObject({title:'Oferta',funnelStages:['conversion'],status:'review'});expect((await api.readDocument(d.id)).content).toBe(before.content);await expect(api.updateDocument(d.id,{status:'bad' as never})).rejects.toThrow();});
 it('tracks derived docs and acknowledges separately from approval',async()=>{const [base]=await api.listDocuments('demo-work');const derived=await api.createDocument('demo-work','copy','Anuncio',base.id);await api.updateDocument(derived.document.id,{status:'review'});await api.saveDocument(base.id,'changed', (await api.readDocument(base.id)).fingerprint);expect((await api.documentState(derived.document.id)).baseOutdated).toBe(true);expect((await api.acknowledgeBase(derived.document.id)).status).toBe('review');expect((await api.documentState(derived.document.id)).baseOutdated).toBe(false);});
 it('saves portable profile fields, protects shipped roles and rejects stale edits',async()=>{const input={id:'growth',name:'Growth',initial:'G',summary:'Experimentos',soul:'# Responsabilidad',skills:'# Procedimiento'};const p=await api.saveProfile(input,null);expect(p.directory).toBeNull();expect((await api.listRoles()).some(x=>x.id==='growth')).toBe(true);const updated=await api.saveProfile({...input,soul:'Nuevo'},p.fingerprint);await expect(api.saveProfile(input,p.fingerprint)).rejects.toThrow();expect((await api.listProfiles()).find(x=>x.id==='growth')?.soul).toBe(updated.soul);await expect(api.saveProfile({...input,id:'assistant'},null)).rejects.toThrow();await expect(api.saveProfile({...input,id:'../escape'},null)).rejects.toThrow();});
});
