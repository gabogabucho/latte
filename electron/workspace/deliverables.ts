import fs from 'node:fs';
import path from 'node:path';
import { ValidationError } from '../core/errors';
import type { DeliverableListing } from '../../shared/contracts';

export const DELIVERABLES_DIR = 'entregables';
const EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'html', 'htm', 'csv', 'tsv', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp3', 'mp4', 'wav', 'odt', 'ods', 'odp']);
const LIMIT = 200;

export function deliverableName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 180 || value.startsWith('.') || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[ .]$/.test(value) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)) {
    throw new ValidationError('Nombre de entregable inválido');
  }
  if (!EXTENSIONS.has(path.extname(value).slice(1).toLowerCase())) throw new ValidationError('Formato de entregable no permitido');
  return value;
}

/** Filesystem catalog, not a document database. Never follows child links. */
export class DeliverableFiles {
  constructor(private readonly workDir: string) {}

  directory(): string {
    // The user-selected work root may have canonical ancestors. Children may not escape it.
    const root = fs.realpathSync(this.workDir);
    const dir = path.join(root, DELIVERABLES_DIR);
    try { fs.mkdirSync(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(dir) !== dir) throw new ValidationError('entregables debe ser una carpeta real, no un archivo ni un enlace');
    return dir;
  }

  resolve(name: unknown): string {
    const dir = this.directory();
    const file = path.join(dir, deliverableName(name));
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1 || fs.realpathSync(file) !== file) throw new ValidationError('El entregable debe ser un archivo real sin enlaces');
    return file;
  }

  list(): DeliverableListing {
    const dir = this.directory();
    const files: DeliverableListing['files'] = [];
    let truncated = false;
    // opendir avoids loading an arbitrarily large directory into memory.
    const handle = fs.opendirSync(dir);
    try {
      let entry: fs.Dirent | null;
      let scanned = 0;
      while ((entry = handle.readSync())) {
        if (++scanned > 2000 || files.length >= LIMIT) { truncated = true; break; }
        if (!entry.isFile() || entry.isSymbolicLink()) continue;
        try {
          const file = this.resolve(entry.name);
          const stat = fs.statSync(file);
          files.push({ fileName: entry.name, extension: path.extname(entry.name).slice(1).toLowerCase(), bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
        } catch { /* Invalid/vanished files are not actions the UI can offer. */ }
      }
    } finally { handle.closeSync(); }
    return { files: files.sort((a, b) => a.fileName.localeCompare(b.fileName)), truncated };
  }

  copy(name: string, destination: string): void {
    const source = this.resolve(name);
    if (!path.isAbsolute(destination)) throw new ValidationError('El destino debe ser absoluto');
    const base = path.basename(destination);
    deliverableName(base);
    if (path.extname(base).toLowerCase() !== path.extname(name).toLowerCase()) throw new ValidationError('La copia debe conservar el formato original');
    const target = path.join(fs.realpathSync(path.dirname(destination)), base);
    // Exclusive creation never overwrites an existing file, symlink or the source.
    try {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      // The save dialog offers to replace; Latte does not. Saying so beats an errno.
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ValidationError('Ya hay un archivo con ese nombre en el destino. Elegí otro nombre: Latte no reemplaza archivos.');
      throw error;
    }
  }
}
