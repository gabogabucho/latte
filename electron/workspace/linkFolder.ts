import fs from 'node:fs';
import path from 'node:path';

/**
 * Using a folder you already work in, instead of copying it.
 *
 * Latte does not duplicate the client's material: the work points at that
 * folder and every deliverable, version and export happens there. In exchange,
 * Latte writes its own files inside it (the managed context files and a
 * `.latte/` folder for snapshots), and any agent you open gets that folder as
 * its working directory. That is a real consequence and the UI says it before
 * the folder is linked.
 */
export interface FolderCheck {
  ok: boolean;
  /** Why the folder cannot be used, in the user's language. */
  reason?: string;
}

const MAX_SCAN_ENTRIES = 2_000;
/** Tool folders: listed nowhere, because they are not the client's material. */
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '__pycache__', 'venv', '.venv']);

/** Refuses folders that would be a bad idea to hand to an agent. */
export function checkFolder(directory: string, dataRoot: string): FolderCheck {
  let resolved: string;
  try {
    resolved = path.resolve(directory);
  } catch {
    return { ok: false, reason: 'La ruta no es válida.' };
  }
  if (!path.isAbsolute(resolved)) return { ok: false, reason: 'La ruta tiene que ser absoluta.' };
  const parsed = path.parse(resolved);
  if (parsed.root === resolved) return { ok: false, reason: 'No se puede usar la raíz de un disco: elegí una carpeta del proyecto.' };
  // The home folder holds everything: an agent's working directory should be narrower.
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  if (home && path.resolve(home) === resolved) return { ok: false, reason: 'No se puede usar la carpeta personal completa: elegí la carpeta del cliente.' };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, reason: 'La carpeta no existe o no se puede leer.' };
  }
  if (!stat.isDirectory()) return { ok: false, reason: 'Eso no es una carpeta.' };
  if (contains(dataRoot, resolved) || path.resolve(dataRoot) === resolved) {
    return { ok: false, reason: 'Esa carpeta es la que Latte usa para sus propios datos.' };
  }
  try {
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch {
    return { ok: false, reason: 'No hay permiso de escritura en esa carpeta.' };
  }
  return { ok: true };
}

export function contains(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export interface FolderScan {
  /** Markdown at the top level: these become tracked documents. */
  markdown: string[];
  /** Everything else at the top level, listed so the person knows what is there. */
  otherFiles: string[];
  subfolders: string[];
  /** True when the folder already has Latte's managed files. */
  alreadyLatte: boolean;
}

/** Looks at the top level only. Deep trees are the agent's job, not the importer's. */
export function scanFolder(directory: string): FolderScan {
  const markdown: string[] = [];
  const otherFiles: string[] = [];
  const subfolders: string[] = [];
  let alreadyLatte = false;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true }).slice(0, MAX_SCAN_ENTRIES);
  } catch {
    return { markdown, otherFiles, subfolders, alreadyLatte };
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (name === '.latte') alreadyLatte = true;
      if (!name.startsWith('.') && !SKIP_DIRECTORIES.has(name.toLowerCase())) subfolders.push(name);
      continue;
    }
    if (!entry.isFile() || name.startsWith('.')) continue;
    if (name === 'CLAUDE.md' || name === 'AGENTS.md') { alreadyLatte = true; continue; }
    if (/\.md$/i.test(name)) markdown.push(name);
    else otherFiles.push(name);
  }
  return { markdown, otherFiles, subfolders, alreadyLatte };
}

/** A readable title from a file name, for the document list. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  if (!base) return 'Documento';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Guesses a document kind from the file name; unknown stays a plain note. */
export function kindFromFileName(name: string): string {
  const base = name.toLowerCase();
  if (/brief|encargo|pedido/.test(base)) return 'brief';
  if (/estrateg|strategy/.test(base)) return 'strategy';
  if (/calendar|cronograma|agenda/.test(base)) return 'calendar';
  if (/research|investigac|entrevista/.test(base)) return 'research';
  if (/copy|piezas|posts|mensajes/.test(base)) return 'copy';
  return 'note';
}
