import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readTextIfExists, writeFileAtomic, writeImmutableFile } from '../../electron/core/atomicFile';
import { isValidId, newId, slugify } from '../../electron/core/ids';
import { LattePaths, safeJoin } from '../../electron/core/paths';
import { makeTempDir, removeDir } from './helpers';

describe('safeJoin', () => {
  const root = path.resolve('/latte-root');

  it('joins plain segments under the root', () => {
    expect(safeJoin(root, 'brands', 'brd_abc')).toBe(path.resolve(root, 'brands', 'brd_abc'));
  });

  it.each([
    ['..'],
    ['.'],
    ['../etc'],
    ['a/b'],
    ['a\\b'],
    ['C:evil'],
    [''],
    ['nul\0byte'],
  ])('rejects unsafe segment %j', (segment) => {
    expect(() => safeJoin(root, segment)).toThrow(/Unsafe path segment|Empty path segment/);
  });
});

describe('LattePaths', () => {
  const paths = new LattePaths('/data');

  it('builds work paths from validated ids only', () => {
    const dir = paths.workDir('brd_demo', 'wrk_demo');
    expect(dir.startsWith(paths.root)).toBe(true);
    expect(dir.endsWith(path.join('brands', 'brd_demo', 'works', 'wrk_demo'))).toBe(true);
  });

  it.each([['../x'], ['Brand'], ['br'], ['brd.x'], ['brd/x'], [123]])('rejects invalid id %j', (id) => {
    expect(() => paths.brandDir(id as string)).toThrow(/Invalid brandId/);
  });
});

describe('ids', () => {
  it('generates ids that satisfy the id pattern', () => {
    for (const prefix of ['brd', 'wrk', 'rev', 'dec', 'ses'] as const) {
      const id = newId(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(isValidId(id)).toBe(true);
    }
  });

  it('slugifies titles for export file names', () => {
    expect(slugify('Lanzamiento Cosecha 2026 · Ñandú')).toBe('lanzamiento-cosecha-2026-nandu');
    expect(slugify('***', 'deliverable')).toBe('deliverable');
  });
});

describe('atomic files', () => {
  let dir: string;
  afterEach(() => removeDir(dir));

  it('writes atomically and leaves no temp files', () => {
    dir = makeTempDir();
    const file = path.join(dir, 'nested', 'doc.md');
    writeFileAtomic(file, 'hello');
    writeFileAtomic(file, 'hello again');
    expect(readTextIfExists(file)).toBe('hello again');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['doc.md']);
  });

  it('never overwrites an immutable file', () => {
    dir = makeTempDir();
    const file = path.join(dir, 'snap.md');
    writeImmutableFile(file, 'v1');
    expect(() => writeImmutableFile(file, 'v2')).toThrow(/already exists/);
    expect(readTextIfExists(file)).toBe('v1');
    const mode = fs.statSync(file).mode & 0o222;
    expect(mode).toBe(0);
  });

  it('returns null for missing files', () => {
    dir = makeTempDir();
    expect(readTextIfExists(path.join(dir, 'nope.md'))).toBeNull();
  });
});
