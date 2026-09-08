import fs from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { DeliverableFiles, DELIVERABLES_DIR, deliverableName } from '../../electron/workspace/deliverables';
import { makeBackend, makeTempDir, removeDir } from './helpers';

function write(dir: string, name: string, content = 'x'): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

it('lists what the agent left, with its metadata, and nothing else', () => {
  const dir = makeTempDir();
  try {
    const entregables = path.join(dir, DELIVERABLES_DIR);
    write(entregables, 'propuesta.pdf', 'pdf-bytes');
    write(entregables, 'anuncios.xlsx');
    write(entregables, 'landing.html');
    // Not a deliverable Latte will hand over: an executable, and a subfolder.
    write(entregables, 'instalador.exe');
    fs.mkdirSync(path.join(entregables, 'fuentes'));

    const listing = new DeliverableFiles(dir).list();
    expect(listing.files.map(f => f.fileName)).toEqual(['anuncios.xlsx', 'landing.html', 'propuesta.pdf']);
    expect(listing.truncated).toBe(false);
    const pdf = listing.files.find(f => f.fileName === 'propuesta.pdf')!;
    expect(pdf).toMatchObject({ extension: 'pdf', bytes: 9 });
    expect(new Date(pdf.modifiedAt).getTime()).toBeGreaterThan(0);
  } finally { removeDir(dir); }
});

it('creates the folder on demand and leaves an existing one alone', () => {
  const dir = makeTempDir();
  try {
    const files = new DeliverableFiles(dir);
    expect(files.list().files).toEqual([]);
    expect(fs.statSync(path.join(dir, DELIVERABLES_DIR)).isDirectory()).toBe(true);
    write(path.join(dir, DELIVERABLES_DIR), 'informe.docx');
    expect(files.list().files.map(f => f.fileName)).toEqual(['informe.docx']);
  } finally { removeDir(dir); }
});

it('refuses names that escape the folder, hide, or are not a deliverable format', () => {
  expect(deliverableName('propuesta.pdf')).toBe('propuesta.pdf');
  // A name with spaces is what a person actually writes; it stays valid.
  expect(deliverableName('Propuesta Casa Oliva v2.pdf')).toBe('Propuesta Casa Oliva v2.pdf');
  for (const bad of ['../fuera.pdf', 'sub/dentro.pdf', 'sub\\dentro.pdf', '.oculto.pdf', 'CON.pdf', 'nul.txt', 'raro?.pdf', 'espacio.pdf ', 'punto.pdf.']) {
    expect(() => deliverableName(bad)).toThrow(/inválido|no permitido/i);
  }
  for (const bad of ['script.exe', 'archivo', 'macro.docm', 42, null]) {
    expect(() => deliverableName(bad as never)).toThrow();
  }
});

it('refuses a link where the deliverables folder should be', () => {
  const dir = makeTempDir();
  try {
    fs.mkdirSync(path.join(dir, 'afuera'));
    // A junction is the Windows-portable way to point a directory elsewhere.
    fs.symlinkSync(path.join(dir, 'afuera'), path.join(dir, DELIVERABLES_DIR), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => new DeliverableFiles(dir).list()).toThrow(/carpeta real/i);
  } finally { removeDir(dir); }
});

it('refuses a file sitting where the deliverables folder should be', () => {
  const dir = makeTempDir();
  try {
    write(dir, DELIVERABLES_DIR + '');
    fs.writeFileSync(path.join(dir, DELIVERABLES_DIR), 'no soy una carpeta');
    expect(() => new DeliverableFiles(dir).list()).toThrow(/carpeta real/i);
  } finally { removeDir(dir); }
});

it('copies keeping the format, and never replaces what is already there', () => {
  const dir = makeTempDir();
  const destination = makeTempDir();
  try {
    write(path.join(dir, DELIVERABLES_DIR), 'propuesta.pdf', 'contenido');
    const files = new DeliverableFiles(dir);

    files.copy('propuesta.pdf', path.join(destination, 'propuesta final.pdf'));
    expect(fs.readFileSync(path.join(destination, 'propuesta final.pdf'), 'utf8')).toBe('contenido');
    // The original stays where the agent left it.
    expect(fs.existsSync(path.join(dir, DELIVERABLES_DIR, 'propuesta.pdf'))).toBe(true);

    expect(() => files.copy('propuesta.pdf', path.join(destination, 'propuesta final.pdf'))).toThrow(/Ya hay un archivo/i);
    expect(() => files.copy('propuesta.pdf', path.join(destination, 'propuesta.docx'))).toThrow(/formato original/i);
    expect(() => files.copy('propuesta.pdf', path.join('relativo', 'copia.pdf'))).toThrow(/absoluto/i);
    expect(() => files.copy('otra.pdf', path.join(destination, 'otra.pdf'))).toThrow();
  } finally { removeDir(dir); removeDir(destination); }
});

it('serves the deliverables of a linked client folder, in that folder', async () => {
  const source = makeTempDir();
  const b = await makeBackend({ chooseFolder: async () => source });
  try {
    const brand = await b.service.createBrand('Cliente');
    const work = await b.service.createWork(brand.id, 'Trabajo');
    const managedDir = b.files.workDir(brand.id, work.id);
    if (!await b.service.useFolder(work.id)) throw new Error('expected a link');
    write(path.join(source, DELIVERABLES_DIR), 'informe.pdf', 'contenido');

    expect((await b.service.listDeliverables(work.id)).files.map(f => f.fileName)).toEqual(['informe.pdf']);
    // Nothing was copied: the deliverables live in the client's own folder.
    expect(fs.existsSync(path.join(managedDir, DELIVERABLES_DIR))).toBe(false);
  } finally { b.cleanup(); removeDir(source); }
});

it('hands a deliverable over only through explicit actions, and asks again for HTML', async () => {
  const confirmHtml = vi.fn(async () => false);
  const revealPath = vi.fn(async () => {});
  const revealFile = vi.fn(async () => {});
  let chosen: string | null = null;
  const b = await makeBackend({
    confirmHtml,
    revealPath,
    revealFile,
    chooseExportPath: async () => chosen,
  });
  try {
    const brand = await b.service.createBrand('Bruma');
    const work = await b.service.createWork(brand.id, 'Lanzamiento');
    const folder = path.join(b.files.workDir(brand.id, work.id), DELIVERABLES_DIR);
    write(folder, 'propuesta.pdf', 'contenido');
    write(folder, 'landing.html', '<h1>hola</h1>');

    expect((await b.service.listDeliverables(work.id)).files.map(f => f.fileName)).toEqual(['landing.html', 'propuesta.pdf']);

    // A PDF opens with one click; the HTML asks first, and a no means nothing opens.
    await b.service.openDeliverable(work.id, 'propuesta.pdf');
    expect(revealPath).toHaveBeenCalledWith(path.join(folder, 'propuesta.pdf'));
    await b.service.openDeliverable(work.id, 'landing.html');
    expect(confirmHtml).toHaveBeenCalledWith('landing.html');
    expect(revealPath).toHaveBeenCalledTimes(1);
    confirmHtml.mockResolvedValueOnce(true);
    await b.service.openDeliverable(work.id, 'landing.html');
    expect(revealPath).toHaveBeenLastCalledWith(path.join(folder, 'landing.html'));

    await b.service.revealDeliverable(work.id, 'propuesta.pdf');
    expect(revealFile).toHaveBeenCalledWith(path.join(folder, 'propuesta.pdf'));

    // Cancelling the save dialog copies nothing and is not an error.
    expect(await b.service.copyDeliverable(work.id, 'propuesta.pdf')).toBeNull();
    const destination = makeTempDir();
    try {
      chosen = path.join(destination, 'propuesta.pdf');
      expect(await b.service.copyDeliverable(work.id, 'propuesta.pdf')).toBe(chosen);
      expect(fs.readFileSync(chosen, 'utf8')).toBe('contenido');
      await expect(b.service.copyDeliverable(work.id, 'no-existe.pdf')).rejects.toThrow();
      await expect(b.service.openDeliverable(work.id, '../brief.md')).rejects.toThrow();
    } finally { removeDir(destination); }
  } finally { b.cleanup(); }
});
