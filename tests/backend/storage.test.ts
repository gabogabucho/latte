import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlDriver } from '../../electron/storage/driver';
import { openDriver, type DriverPreference } from '../../electron/storage/openDriver';
import { briefDocumentId, LatteRepository } from '../../electron/storage/repository';
import { makeTempDir, removeDir } from './helpers';

const ENGINES: DriverPreference[] = ['node:sqlite', 'sql.js'];

describe.each(ENGINES)('LatteRepository on %s', (engine) => {
  let dir: string;
  let driver: SqlDriver;
  let repo: LatteRepository;

  beforeEach(async () => {
    dir = makeTempDir();
    const opened = await openDriver(path.join(dir, 'latte.db'), engine);
    driver = opened.driver;
    expect(driver.kind).toBe(engine);
    repo = new LatteRepository(driver);
    repo.migrate();
  });

  afterEach(() => {
    try { repo.close(); } catch { /* closed by test */ }
    removeDir(dir);
  });

  it('migrates idempotently', () => {
    expect(() => repo.migrate()).not.toThrow();
    expect(repo.countBrands()).toBe(0);
  });

  it('stores and lists brands, works, revisions and decisions', () => {
    repo.insertBrand({ id: 'brd_one', name: 'One', context: '', createdAt: '2026-01-01T00:00:00.000Z' });
    repo.insertBrand({ id: 'brd_two', name: 'Two', context: 'ctx', createdAt: '2026-01-02T00:00:00.000Z' });
    expect(repo.listBrands().map((b) => b.id)).toEqual(['brd_one', 'brd_two']);

    repo.updateBrandContext('brd_one', 'new context');
    expect(repo.getBrand('brd_one').context).toBe('new context');

    repo.insertWork({ id: 'wrk_a', brandId: 'brd_one', title: 'A', brief: '', folder: null, updatedAt: '2026-01-03T00:00:00.000Z' });
    repo.insertWork({ id: 'wrk_b', brandId: 'brd_one', title: 'B', brief: '', folder: null, updatedAt: '2026-01-04T00:00:00.000Z' });
    expect(repo.listWorks('brd_one').map((w) => w.id)).toEqual(['wrk_b', 'wrk_a']);
    expect(repo.listWorks('brd_two')).toEqual([]);

    repo.updateBrief('wrk_a', 'the brief', '2026-01-05T00:00:00.000Z');
    expect(repo.getWork('wrk_a')).toMatchObject({ brief: 'the brief', updatedAt: '2026-01-05T00:00:00.000Z' });
    expect(repo.listWorks('brd_one')[0].id).toBe('wrk_a');

    repo.insertRevision({ id: 'rev_1', workId: 'wrk_a', documentId: briefDocumentId('wrk_a'), source: 'human', content: 'v1', createdAt: '2026-01-06T00:00:00.000Z' });
    repo.insertRevision({ id: 'rev_2', workId: 'wrk_a', documentId: briefDocumentId('wrk_a'), source: 'human', content: 'v2', createdAt: '2026-01-07T00:00:00.000Z' });
    expect(repo.listRevisions('wrk_a').map((r) => r.content)).toEqual(['v2', 'v1']); // newest first
    expect(repo.latestRevision('wrk_a')?.id).toBe('rev_2');

    repo.insertDecision({ id: 'dec_1', workId: 'wrk_a', text: 'Decided', createdAt: '2026-01-08T00:00:00.000Z' });
    expect(repo.listDecisions('wrk_a')).toHaveLength(1);
  });

  it('throws NotFound for unknown ids', () => {
    expect(() => repo.getBrand('brd_missing')).toThrow(/Brand not found/);
    expect(() => repo.getWork('wrk_missing')).toThrow(/Work not found/);
    expect(() => repo.updateBrief('wrk_missing', 'brief', '2026-01-01T00:00:00.000Z')).toThrow(/Work not found/);
  });

  it('enforces revision immutability at the database level', () => {
    repo.insertBrand({ id: 'brd_one', name: 'One', context: '', createdAt: '2026-01-01T00:00:00.000Z' });
    repo.insertWork({ id: 'wrk_a', brandId: 'brd_one', title: 'A', brief: '', folder: null, updatedAt: '2026-01-03T00:00:00.000Z' });
    repo.insertRevision({ id: 'rev_1', workId: 'wrk_a', documentId: briefDocumentId('wrk_a'), source: 'human', content: 'v1', createdAt: '2026-01-06T00:00:00.000Z' });

    expect(() => driver.run('UPDATE revisions SET content = ? WHERE id = ?', ['hacked', 'rev_1'])).toThrow(/immutable/);
    expect(() => driver.run('DELETE FROM revisions WHERE id = ?', ['rev_1'])).toThrow(/immutable/);
    expect(repo.listRevisions('wrk_a')[0].content).toBe('v1');
  });

  it('enforces foreign keys', () => {
    expect(() =>
      repo.insertWork({ id: 'wrk_orphan', brandId: 'brd_ghost', title: 'X', brief: '', folder: null, updatedAt: '2026-01-01T00:00:00.000Z' }),
    ).toThrow();
  });

  it('rolls back a failed transaction', () => {
    repo.insertBrand({ id: 'brd_one', name: 'One', context: '', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(() =>
      repo.transaction(() => {
        repo.insertWork({ id: 'wrk_a', brandId: 'brd_one', title: 'A', brief: '', folder: null, updatedAt: '2026-01-03T00:00:00.000Z' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(repo.listWorks('brd_one')).toEqual([]);
  });

  it('persists to disk and reopens with the same engine', async () => {
    repo.insertBrand({ id: 'brd_one', name: 'Persisted', context: '', createdAt: '2026-01-01T00:00:00.000Z' });
    repo.close();
    const file = path.join(dir, 'latte.db');
    expect(fs.existsSync(file)).toBe(true);

    const reopened = await openDriver(file, engine);
    const repo2 = new LatteRepository(reopened.driver);
    repo2.migrate();
    expect(repo2.listBrands().map((b) => b.name)).toEqual(['Persisted']);
    repo2.close();
    // Keep afterEach happy.
    const again = await openDriver(file, engine);
    repo = new LatteRepository(again.driver);
    driver = again.driver;
  });
});

describe('openDriver auto', () => {
  it('prefers node:sqlite when the builtin exists', async () => {
    const dir = makeTempDir();
    try {
      const opened = await openDriver(path.join(dir, 'latte.db'), 'auto');
      expect(opened.driver.kind).toBe('node:sqlite');
      expect(opened.reason).toMatch(/builtin/);
      opened.driver.close();
    } finally {
      removeDir(dir);
    }
  });
});

describe('cross-engine compatibility', () => {
  it('sql.js opens a database written by node:sqlite', async () => {
    const dir = makeTempDir();
    try {
      const file = path.join(dir, 'latte.db');
      const primary = await openDriver(file, 'node:sqlite');
      const repo = new LatteRepository(primary.driver);
      repo.migrate();
      repo.insertBrand({ id: 'brd_x', name: 'Cross', context: '', createdAt: '2026-01-01T00:00:00.000Z' });
      repo.close();
      // WAL content must be checkpointed into the main file for a foreign reader.
      expect(fs.existsSync(file)).toBe(true);

      const fallback = await openDriver(file, 'sql.js');
      const repo2 = new LatteRepository(fallback.driver);
      repo2.migrate();
      expect(repo2.listBrands().map((b) => b.name)).toEqual(['Cross']);
      repo2.close();
    } finally {
      removeDir(dir);
    }
  });
});
