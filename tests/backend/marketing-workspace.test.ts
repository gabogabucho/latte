import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { makeBackend, makeTempDir, removeDir, fakeRunner } from './helpers';
import { openDriver } from '../../electron/storage/openDriver';
import { LatteRepository } from '../../electron/storage/repository';
import { SCHEMA_SQL } from '../../electron/storage/schema';
import { startFakeOpenCode } from './fakeOpenCode';

it('persists explicit stages without changing document identity, file, content or revisions', async () => {
  const b = await makeBackend();
  try {
    const brand = await b.service.createBrand('Bruma');
    const work = await b.service.createWork(brand.id, 'Suscripcion');
    const before = (await b.service.listDocuments(work.id))[0];
    expect(before.funnelStages).toEqual([]);
    const content = await b.service.readDocument(before.id);
    const revisions = await b.service.listDocumentRevisions(before.id);
    const after = await b.service.updateDocument(before.id, { status: 'review', funnelStages: ['discovery', 'conversion', 'discovery'] });
    expect(after.funnelStages).toEqual(['discovery', 'conversion']);
    expect(after).toMatchObject({ id: before.id, fileName: before.fileName, status: 'review' });
    expect((await b.service.readDocument(before.id)).content).toBe(content.content);
    expect(await b.service.listDocumentRevisions(before.id)).toEqual(revisions);
    await expect(b.service.updateDocument(before.id, { funnelStages: ['bad'] } as never)).rejects.toThrow();
    expect((await b.service.listDocuments(work.id))[0].funnelStages).toEqual(['discovery', 'conversion']);
  } finally { b.cleanup(); }
});

it.each(['node:sqlite', 'sql.js'] as const)('migrates legacy v5 and reopens twice without losing metadata on %s', async engine => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, 'latte.db');
    const opened = await openDriver(file, engine);
    opened.driver.exec(SCHEMA_SQL.replace("  funnel_stages  TEXT NOT NULL DEFAULT '[]',", ''));
    opened.driver.run("INSERT INTO brands VALUES ('b', 'Bruma', '', 'now')");
    opened.driver.run("INSERT INTO works VALUES ('w', 'b', 'Legacy', 'content', NULL, 'now')");
    opened.driver.close();
    for (let pass = 0; pass < 2; pass++) {
      const { driver } = await openDriver(file, engine);
      const repo = new LatteRepository(driver);
      repo.migrate(); repo.migrate();
      expect(repo.getMeta('schema_version')).toBe('6');
      expect(repo.getWork('w').brief).toBe('content');
      const document = repo.briefDocument('w');
      expect(document.funnelStages).toEqual(pass === 0 ? [] : ['retention']);
      repo.updateDocument(document.id, { funnelStages: ['retention'], updatedAt: 'now' });
      repo.close();
    }
  } finally { removeDir(dir); }
});

it('supplies custom SOUL and skills to runtime, leaves active prompt unchanged and refreshes on resume', async () => {
  const fake = await startFakeOpenCode();
  const b = await makeBackend({ chatEndpoint: fake.endpoint, runner: fakeRunner(() => ({ code: 0, stdout: '1.0.0' })) });
  try {
    const brand = await b.service.createBrand('Bruma');
    const work = await b.service.createWork(brand.id, 'Campaign');
    const input = { id: 'bruma-editor', name: 'Bruma editor', initial: 'B', summary: 'Campaigns', soul: 'ORIGINAL SOUL', skills: 'UNIQUE SKILL' };
    const profile = await b.service.saveProfile(input, null);
    const member = await b.service.addTeamMember(work.id, input.id, { runtime: 'opencode' });
    const prompt = () => (fake.requests.filter(r => r.path.endsWith('/prompt_async')).at(-1)?.body as { system: string }).system;
    await b.service.sendChat(member.id, 'Hello');
    expect(prompt()).toContain('ORIGINAL SOUL'); expect(prompt()).toContain('UNIQUE SKILL');
    await b.service.saveProfile({ ...input, soul: 'NEW SOUL' }, profile.fingerprint);
    await b.service.openTeamMember(member.id);
    await b.service.sendChat(member.id, 'Again');
    expect(prompt()).toContain('ORIGINAL SOUL'); expect(prompt()).not.toContain('NEW SOUL');
    await b.service.pauseTeamMember(member.id);
    await b.service.openTeamMember(member.id);
    await b.service.sendChat(member.id, 'Resumed');
    expect(prompt()).toContain('NEW SOUL');
  } finally { b.cleanup(); await fake.close(); }
});

it('exposes file-backed profiles with protected builtins and optimistic edits', async () => {
  const b = await makeBackend();
  try {
    expect((await b.service.listProfiles())[0].source).toBe('builtin');
    const input = { id: 'bruma-editor', name: 'Bruma', initial: 'B', summary: 'Cafe', soul: '# Soul', skills: '# Skill' };
    const profile = await b.service.saveProfile(input, null);
    expect(fs.readFileSync(path.join(profile.directory!, 'SOUL.md'), 'utf8')).toBe(input.soul);
    await expect(b.service.saveProfile(input, null)).rejects.toThrow();
    fs.writeFileSync(path.join(profile.directory!, 'SOUL.md'), '# External');
    await expect(b.service.saveProfile(input, profile.fingerprint)).rejects.toThrow(/conflict/i);
    expect((await b.service.listProfiles()).find(p => p.id === input.id)?.soul).toBe('# External');
    await expect(b.service.saveProfile({ ...input, id: 'assistant' }, null)).rejects.toThrow();
  } finally { b.cleanup(); }
});
