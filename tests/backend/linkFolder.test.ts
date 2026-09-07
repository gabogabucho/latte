import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkFolder, kindFromFileName, scanFolder, titleFromFileName, importFileName } from '../../electron/workspace/linkFolder';
import { makeBackend, makeTempDir, removeDir, type TestBackend } from './helpers';

/** A folder like the one a person already has for a client. */
function clientFolder() {
  const dir = makeTempDir('latte-cliente-');
  fs.writeFileSync(path.join(dir, 'brief del cliente.md'), '# Lo que pidió el cliente\n\nUn lanzamiento.');
  fs.writeFileSync(path.join(dir, 'estrategia.md'), '# Estrategia previa\n');
  fs.writeFileSync(path.join(dir, 'presupuesto.xlsx'), 'binario');
  fs.writeFileSync(path.join(dir, 'notas.txt'), 'apuntes sueltos');
  fs.mkdirSync(path.join(dir, 'fotos'));
  fs.writeFileSync(path.join(dir, 'fotos', 'portada.jpg'), 'jpeg');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, '.env'), 'SECRETO=1');
  return dir;
}

describe('Using an existing folder as the work', () => {
  let b: TestBackend | null = null;
  const dirs: string[] = [];
  afterEach(() => { b?.cleanup(); b = null; for (const d of dirs.splice(0)) removeDir(d); });

  it('works in that folder without copying, and registers its Markdown', async () => {
    const source = clientFolder(); dirs.push(source);
    b = await makeBackend({ chooseFolder: async () => source });
    const brand = await b.service.createBrand('Cliente');
    const work = await b.service.createWork(brand.id, 'Trabajo');
    const managedDir = b.files.workDir(brand.id, work.id);

    const result = await b.service.useFolder(work.id);
    if (!result) throw new Error('expected a link');
    expect(result.folder).toBe(path.resolve(source));
    expect(result.work.folder).toBe(path.resolve(source));

    // Nothing was copied: the client's files are still the originals, in place.
    expect(fs.readFileSync(path.join(source, 'presupuesto.xlsx'), 'utf8')).toBe('binario');
    expect(fs.existsSync(path.join(managedDir, 'presupuesto.xlsx'))).toBe(false);

    // Top-level Markdown is now tracked, with a kind guessed from the name.
    expect(result.documents.map((d) => [d.fileName, d.kind]).sort()).toEqual([['brief del cliente.md', 'brief'], ['estrategia.md', 'strategy']]);
    const documents = await b.service.listDocuments(work.id);
    expect(documents.map((d) => d.fileName)).toContain('estrategia.md');
    const read = await b.service.readDocument(result.documents[0].id);
    expect(read.content).toContain('Lo que pidió el cliente');

    // Everything else is reported, untouched.
    expect(result.otherFiles).toEqual(['notas.txt', 'presupuesto.xlsx']);
    expect(result.subfolders).toEqual(['fotos']);

    // Latte's own files now live in the client's folder, and it says which.
    for (const file of ['CLAUDE.md', 'AGENTS.md', 'README.md']) {
      expect(fs.existsSync(path.join(source, file)), file).toBe(true);
    }
    expect(result.managedFiles).toContain('CLAUDE.md');
    expect(fs.readFileSync(path.join(source, 'CLAUDE.md'), 'utf8')).toContain('estrategia.md');

    // From here on, saving and versioning happen in that folder.
    const saved = await b.service.saveDocument(result.documents[1].id, '# Estrategia editada', read.fingerprint === '' ? null : (await b.service.readDocument(result.documents[1].id)).fingerprint);
    expect(saved.status).toBe('saved');
    expect(fs.readFileSync(path.join(source, 'estrategia.md'), 'utf8')).toBe('# Estrategia editada');
    const revision = await b.service.snapshotDocument(result.documents[1].id);
    expect(revision.content).toBe('# Estrategia editada');
    expect(fs.existsSync(path.join(source, '.latte', 'snapshots'))).toBe(true);
  });

  it('survives a restart: the work still points at the folder', async () => {
    const source = clientFolder(); dirs.push(source);
    const dataDir = makeTempDir(); dirs.push(dataDir);
    const first = await makeBackend({ dataDir, chooseFolder: async () => source });
    const brand = await first.service.createBrand('Cliente');
    const work = await first.service.createWork(brand.id, 'Trabajo');
    await first.service.useFolder(work.id);
    first.service.shutdown();

    const reopened = await makeBackend({ dataDir, chooseFolder: async () => source });
    b = reopened;
    expect(reopened.files.workDir(brand.id, work.id)).toBe(path.resolve(source));
    const works = await reopened.service.listWorks(brand.id);
    expect(works[0].folder).toBe(path.resolve(source));
    expect((await reopened.service.listDocuments(work.id)).map((d) => d.fileName)).toContain('estrategia.md');
  });

  it('refuses folders that would be a bad idea, and a folder already in use', async () => {
    const source = clientFolder(); dirs.push(source);
    b = await makeBackend({ chooseFolder: async () => source });
    const brand = await b.service.createBrand('Cliente');
    const first = await b.service.createWork(brand.id, 'Primero');
    const second = await b.service.createWork(brand.id, 'Segundo');
    await b.service.useFolder(first.id);
    await expect(b.service.useFolder(second.id)).rejects.toThrow(/ya la usa el trabajo/);

    const dataRoot = b.dir;
    expect(checkFolder(path.join(dataRoot, 'brands'), dataRoot)).toMatchObject({ ok: false });
    expect(checkFolder(path.parse(process.cwd()).root, dataRoot)).toMatchObject({ ok: false });
    expect(checkFolder(path.join(source, 'no-existe'), dataRoot)).toMatchObject({ ok: false });
    expect(checkFolder(path.join(source, 'notas.txt'), dataRoot)).toMatchObject({ ok: false });
    const home = process.env.USERPROFILE ?? process.env.HOME;
    if (home) expect(checkFolder(home, dataRoot)).toMatchObject({ ok: false });
    expect(checkFolder(source, dataRoot).ok).toBe(true);
  });

  it('reads only the top level and ignores tool folders and hidden files', () => {
    const source = clientFolder(); dirs.push(source);
    const scan = scanFolder(source);
    expect(scan.markdown).toEqual(['brief del cliente.md', 'estrategia.md']);
    expect(scan.otherFiles).toEqual(['notas.txt', 'presupuesto.xlsx']);
    // Tool folders are not the client's material: they are not even listed.
    expect(scan.subfolders).toEqual(['fotos']);
    expect(scan.alreadyLatte).toBe(false);
    expect(JSON.stringify(scan)).not.toContain('.env');

    expect(titleFromFileName('brief-del-cliente.md')).toBe('Brief del cliente');
    expect(kindFromFileName('CALENDARIO abril.md')).toBe('calendar');
    expect(kindFromFileName('cosas.md')).toBe('note');
  });
});

it('accepts a file name from anywhere on the disk without letting it out of the folder', () => {
  expect(importFileName('C:/clientes/La Mereta/propuesta final.docx')).toBe('propuesta final.docx');
  expect(importFileName('/home/x/notas.md')).toBe('notas.md');
  // Only the base name survives: a picker hands back absolute paths.
  expect(importFileName('../../.././etc/passwd')).toBe('passwd');
  expect(importFileName('..')).toBe('archivo');
  // Windows forbids these, and a reserved device gets a prefix instead of a refusal.
  expect(importFileName('a<b>c:d"e|f?g*h.txt')).toBe('a-b-c-d-e-f-g-h.txt');
  expect(importFileName('CON.txt')).toBe('_CON.txt');
  expect(importFileName('nul')).toBe('_nul');
  expect(importFileName('.oculto.md')).toBe('oculto.md');
  expect(importFileName(`x${String.fromCharCode(0)}y.md`)).toBe('x-y.md');
  expect(importFileName('a'.repeat(400) + '.md').length).toBeLessThanOrEqual(120);
});
