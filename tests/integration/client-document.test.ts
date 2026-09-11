import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { createBackend, type Backend } from '../../electron/bootstrap';
import { DELIVERABLES_DIR } from '../../electron/workspace/deliverables';
import { fakeRunner, makeBackend } from '../backend/helpers';
import { startFakeOpenCode } from '../backend/fakeOpenCode';

// A real, independently parsed and visually inspected PDF; no Python dependency at test time.
const fixtures = fileURLToPath(new URL('../fixtures/client-document/', import.meta.url));

it('carries a verified client PDF from brief and decision through persistence and outcome handoff', async () => {
  const fixture = fs.readFileSync(path.join(fixtures, 'propuesta-bruma.pdf'));
  const verification = JSON.parse(fs.readFileSync(path.join(fixtures, 'verification.json'), 'utf8'));
  expect(createHash('sha256').update(fixture).digest('hex')).toBe(verification.sha256);
  expect(verification.pages).toBe(1);
  expect(verification.text).toContain('Priorizar el origen del café; no prometer beneficios de salud.');
  const fake = await startFakeOpenCode();
  const shellOpenPath = vi.fn(async (_target: string) => {});
  const runner = fakeRunner(() => ({ code: 0, stdout: 'opencode\n' }));
  const b = await makeBackend({ driver: 'sql.js', revealPath: shellOpenPath, runner });
  let reopened: Backend | undefined;
  try {
    const brand = await b.service.createBrand('Bruma (marca ficticia)');
    const context = 'Marca ficticia de café. Tono claro, cercano y sin exageraciones.';
    const brief = 'Presentar una propuesta PDF de lanzamiento para Bruma.';
    const decision = 'Priorizar el origen del café; no prometer beneficios de salud.';
    await b.service.updateBrand(brand.id, context);
    const work = await b.service.createWork(brand.id, 'Propuesta de lanzamiento');
    await b.service.saveBrief(work.id, brief);
    await b.service.addDecision(work.id, decision);
    const draftDocument = await b.service.createDocument(work.id, 'strategy', 'Propuesta Bruma');
    await b.service.saveDocument(draftDocument.document.id, `# Propuesta Bruma\n\n${context}\n\n## Decisión aprobada\n${decision}\n\n## Propuesta\nCampaña: Conocé el origen de tu próxima taza.\n`, draftDocument.fingerprint);
    await b.service.updateDocument(draftDocument.document.id, { status: 'approved' });
    const workDir = b.files.workDir(brand.id, work.id);
    const output = path.join(workDir, DELIVERABLES_DIR, 'propuesta-bruma.pdf');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(fixtures, 'propuesta-bruma.pdf'), output);
    expect((await b.service.listDeliverables(work.id)).files).toEqual([
      expect.objectContaining({ fileName: 'propuesta-bruma.pdf', extension: 'pdf', bytes: fixture.length }),
    ]);
    await b.service.openDeliverable(work.id, 'propuesta-bruma.pdf');
    expect(shellOpenPath).toHaveBeenCalledExactlyOnceWith(output);
    expect(fs.readFileSync(output)).toEqual(fixture);
    await b.service.updateWork(work.id, { expectedOutput: 'Propuesta PDF para cliente', resultPath: 'propuesta-bruma.pdf' });
    b.service.shutdown();
    reopened = await createBackend({ dataDir: b.dir, driver: 'sql.js', seedDemo: false, emit: () => {}, emitChat: () => {}, chooseExportPath: async () => null, revealPath: shellOpenPath, runner, chatEndpoint: fake.endpoint });
    const api = reopened.service;
    expect((await api.listBrands()).find(x => x.id === brand.id)?.context).toBe(context);
    expect((await api.listWorks(brand.id))[0]).toMatchObject({ brief, expectedOutput: 'Propuesta PDF para cliente', resultPath: 'propuesta-bruma.pdf' });
    expect((await api.listDecisions(work.id))[0].text).toBe(decision);
    expect((await api.readDocument(draftDocument.document.id)).document.status).toBe('approved');
    expect((await api.listDeliverables(work.id)).files[0].fileName).toBe('propuesta-bruma.pdf');
    // Fake transport only: verifies the actual conversation/context plumbing, not an agent generation.
    await api.startChat(work.id);
    const instructions = fs.readFileSync(path.join(workDir, 'AGENTS.md'), 'utf8');
    for (const text of [brief, context, decision, 'Propuesta PDF para cliente', `./${DELIVERABLES_DIR}/propuesta-bruma.pdf`]) expect(instructions).toContain(text);
    await api.updateWork(work.id, { expectedOutput: 'Revisar propuesta PDF para cliente' });
    const reviewer = await api.addTeamMember(work.id, 'strategist');
    await api.sendChat(reviewer.id, 'Revisa el resultado vinculado.');
    const systemFor = (id: string) => {
      const session = reopened!.repo.getMember(id).sessionId;
      return fake.requests.filter(r => r.path === `/session/${session}/prompt_async`).map(r => (r.body as { system?: string }).system ?? '').at(-1);
    };
    expect(systemFor(reviewer.id)).toContain('Revisar propuesta PDF para cliente');
    expect(systemFor(reviewer.id)).toContain(`./${DELIVERABLES_DIR}/propuesta-bruma.pdf`);
    const handoff = await api.draftContinuation(reviewer.id);
    expect(handoff.text).toContain('Revisar propuesta PDF para cliente');
    expect(handoff.text).toContain('propuesta-bruma.pdf');
    expect(handoff.text).toContain('está en la carpeta');
    expect(handoff.text).toContain(draftDocument.document.fileName);
    const continued = await api.addTeamMember(work.id, 'reviewer', { continuedFrom: reviewer.id });
    await api.sendChat(continued.id, handoff.text);
    expect(reopened.repo.getMember(continued.id).continuedFrom).toBe(reviewer.id);
    const continuedSession = reopened.repo.getMember(continued.id).sessionId;
    const firstMessage = fake.requests.filter(r => r.path === `/session/${continuedSession}/prompt_async`).at(-1);
    expect((firstMessage?.body as { parts?: Array<{ text?: string }> }).parts?.[0]?.text).toBe(handoff.text);
    fs.unlinkSync(output);
    expect((await api.listDeliverables(work.id)).files).toEqual([]);
    expect((await api.listWorks(brand.id))[0].resultPath).toBe('propuesta-bruma.pdf');
    await expect(api.openDeliverable(work.id, 'propuesta-bruma.pdf')).rejects.toThrow();
    expect(shellOpenPath).toHaveBeenCalledTimes(1);
    expect((await api.draftContinuation(continued.id)).text).toContain('ya no está');
    const next = await api.addTeamMember(work.id, 'analyst');
    await api.sendChat(next.id, 'Verifica el archivo faltante.');
    expect(systemFor(next.id)).toContain('that file is not there anymore');
  } finally {
    reopened?.service.shutdown();
    b.cleanup();
    await fake.close();
  }
});
