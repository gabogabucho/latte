import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Write-then-rename so a crash mid-write never leaves a half-written file.
 * The temp file lives in the same directory to keep the rename atomic.
 */
export function writeFileAtomic(filePath: string, content: string | Uint8Array): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, filePath);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/** Creates the file only if it does not exist yet, then marks it read-only. */
export function writeImmutableFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    throw new Error(`Immutable file already exists: ${path.basename(filePath)}`);
  }
  writeFileAtomic(filePath, content);
  try {
    fs.chmodSync(filePath, 0o444);
  } catch {
    // Read-only attribute is best-effort (some filesystems ignore it).
  }
}

export function readTextIfExists(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}
