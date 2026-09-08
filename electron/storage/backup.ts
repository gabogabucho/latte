import fs from 'node:fs';
import path from 'node:path';
import { LatteError } from '../core/errors';

/**
 * The database on disk was written by a newer Latte. Opening it would run an
 * older schema over newer data, so the app refuses instead of "just opening"
 * and silently degrading what is there.
 */
export class IncompatibleSchemaError extends LatteError {
  readonly storedVersion: string;
  readonly appVersion: string;
  constructor(storedVersion: string, appVersion: string) {
    super('INCOMPATIBLE_SCHEMA', `La base de datos es de una versión más nueva de Latte (esquema ${storedVersion}; esta versión entiende hasta ${appVersion}).`);
    this.name = 'IncompatibleSchemaError';
    this.storedVersion = storedVersion;
    this.appVersion = appVersion;
  }
}

/** Backups kept per database. Older ones are deleted oldest-first. */
export const BACKUP_LIMIT = 5;
const BACKUP_DIR = 'backups';
const BACKUP_NAME = /^latte-v(.+)-(\d{8}T\d{6})\.db$/;

export interface BackupOptions {
  /** Overridable so the tests do not depend on the wall clock. */
  now?: () => Date;
  limit?: number;
  log?: (line: string) => void;
}

/**
 * Guards the step between opening the database and migrating it.
 *
 * Returns the path of the backup it took, or null when there was nothing to
 * protect: a brand new database, or one already at the current schema. It
 * throws only for the one case where continuing would be destructive.
 */
export function prepareForMigration(
  dbFile: string,
  storedVersion: string | null,
  appVersion: string,
  options: BackupOptions = {},
): string | null {
  if (storedVersion !== null && isNewerSchema(storedVersion, appVersion)) {
    throw new IncompatibleSchemaError(storedVersion, appVersion);
  }
  // Nothing on disk yet, or nothing to change: a backup would only be noise.
  if (storedVersion === null || storedVersion === appVersion) return null;
  if (!fs.existsSync(dbFile)) return null;

  const dir = path.join(path.dirname(dbFile), BACKUP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `latte-v${safeSegment(storedVersion)}-${stamp(options.now?.() ?? new Date())}.db`);
  fs.copyFileSync(dbFile, target);
  // The write-ahead log holds commits that are not in the main file yet. A
  // backup without it can be missing the last session's work, so it travels
  // with the copy and is restored next to it.
  const wal = `${dbFile}-wal`;
  if (fs.existsSync(wal)) fs.copyFileSync(wal, `${target}-wal`);
  options.log?.(`[latte] backup del esquema ${storedVersion} en ${target}`);

  pruneBackups(dir, options.limit ?? BACKUP_LIMIT);
  return target;
}

/** True when the stored schema is numerically ahead of what this build knows. */
export function isNewerSchema(storedVersion: string, appVersion: string): boolean {
  const stored = Number(storedVersion);
  const app = Number(appVersion);
  // A non-numeric version is unknown, not newer: an unreadable marker must not
  // lock the user out of their own data.
  if (!Number.isFinite(stored) || !Number.isFinite(app)) return false;
  return stored > app;
}

/** Keeps the newest `limit` backups and deletes the rest, oldest first. */
export function pruneBackups(dir: string, limit = BACKUP_LIMIT): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const backups = entries.filter((name) => BACKUP_NAME.test(name)).sort((a, b) => {
    const chronological = BACKUP_NAME.exec(a)![2].localeCompare(BACKUP_NAME.exec(b)![2]);
    return chronological || a.localeCompare(b);
  });
  const removed: string[] = [];
  for (const name of backups.slice(0, Math.max(0, backups.length - limit))) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
      fs.rmSync(path.join(dir, `${name}-wal`), { force: true });
      removed.push(name);
    } catch {
      // A backup we cannot delete is not a reason to fail the start-up.
    }
  }
  return removed;
}

/** 20260907T142530 — sorts chronologically as plain text. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._]/g, '_').slice(0, 24) || 'desconocido';
}
