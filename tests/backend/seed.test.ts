import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBackend } from '../../electron/bootstrap';
import { DEMO_BRAND_ID, DEMO_WORK_ID } from '../../electron/services/seed';
import { makeBackend } from './helpers';

describe('demo seed', () => {
  it('seeds Casa Oliva once, clearly labelled as demo, with real files on disk', async () => {
    const b = await makeBackend({ seedDemo: true });
    try {
      expect(b.info.seeded).toBe(true);
      const brands = await b.service.listBrands();
      expect(brands).toHaveLength(1);
      expect(brands[0].id).toBe(DEMO_BRAND_ID);
      expect(brands[0].name).toMatch(/demo/i);
      expect(brands[0].context).toMatch(/DEMO/);

      const works = await b.service.listWorks(DEMO_BRAND_ID);
      expect(works.map((w) => w.id)).toEqual([DEMO_WORK_ID]);
      expect(works[0].brief).toMatch(/^# Encargo/);
      expect(works[0].brief).toContain('## Qué hay que entregar');
      // The demo shows separate deliverables and the reference between them.
      const documents = await b.service.listDocuments(DEMO_WORK_ID);
      expect(documents.map((d) => [d.kind, d.fileName])).toEqual([['brief', 'brief.md'], ['strategy', 'strategy.md'], ['calendar', 'calendar.md']]);
      const strategy = documents[1], calendar = documents[2];
      expect(calendar.baseDocumentId).toBe(strategy.id);
      expect(calendar.baseRevisionId).toBeTruthy();
      expect((await b.service.documentState(calendar.id)).baseOutdated).toBe(false);
      expect((await b.service.readDocument(strategy.id)).content).toContain('## Hipótesis y evidencia');
      expect((await b.service.readDocument(calendar.id)).content).toContain('| Fecha | Canal | Objetivo | Mensaje | CTA |');
      const revisions = await b.service.listRevisions(DEMO_WORK_ID);
      expect(revisions).toHaveLength(2);
      expect((await b.service.listDocumentRevisions(strategy.id)).map((r) => r.id)).toEqual([calendar.baseRevisionId]);
      expect(await b.service.listDecisions(DEMO_WORK_ID)).toHaveLength(3);

      const workDir = path.join(b.dir, 'brands', DEMO_BRAND_ID, 'works', DEMO_WORK_ID);
      expect(fs.readFileSync(path.join(workDir, 'brief.md'), 'utf8')).toBe(works[0].brief);
      for (const file of ['brief.md', 'CLAUDE.md', 'AGENTS.md', 'README.md']) {
        expect(fs.existsSync(path.join(workDir, file))).toBe(true);
      }
      expect(fs.readdirSync(path.join(workDir, '.latte', 'snapshots'))).toHaveLength(2);
      for (const file of ['strategy.md', 'calendar.md']) expect(fs.existsSync(path.join(workDir, file))).toBe(true);
      const claude = fs.readFileSync(path.join(workDir, 'CLAUDE.md'), 'utf8');
      expect(claude).toContain('14 de mayo');
      expect(claude).toContain('latte:pack marketing-core@');
      expect(claude.indexOf('Marketing core')).toBeLessThan(claude.indexOf('## Brand context'));
      expect(b.info.pack).toMatch(/^marketing-core@/);
    } finally {
      b.cleanup();
    }
  });

  it('does not reseed when data already exists', async () => {
    const b = await makeBackend({ seedDemo: false });
    try {
      await b.service.createBrand('Mi marca');
      b.service.shutdown();
      const again = await createBackend({ dataDir: b.dir, version: '0.0.0-test', emit: () => {}, chooseExportPath: async () => null, seedDemo: true });
      try {
        expect(again.info.seeded).toBe(false);
        expect((await again.service.listBrands()).map((x) => x.name)).toEqual(['Mi marca']);
      } finally {
        again.service.shutdown();
      }
    } finally {
      b.cleanup();
    }
  });
});
