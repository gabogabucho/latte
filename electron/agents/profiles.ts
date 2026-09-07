import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentProfile, ProfileInput } from '../../shared/contracts';
import { writeFileAtomic } from '../core/atomicFile';

const FILES = ['profile.json', 'SOUL.md', 'SKILL.md'] as const;
const MAX_TEXT = 256 * 1024;
export function profileFingerprint(parts: string[]): string { return createHash('sha256').update(JSON.stringify(parts)).digest('hex'); }
function validate(input: ProfileInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid profile');
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input.id) || input.id.length > 41 || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(input.id)) throw new TypeError('Invalid profile id');
  for (const [key, limit] of [['name', 120], ['initial', 8], ['summary', 2000], ['soul', MAX_TEXT], ['skills', MAX_TEXT]] as const) {
    if (typeof input[key] !== 'string' || input[key].includes('\0') || Buffer.byteLength(input[key], 'utf8') > limit) throw new TypeError(`Invalid profile ${key}`);
  }
  if (!input.name.trim() || !input.initial.trim() || !input.soul.trim()) throw new TypeError('Profile name, initial and SOUL are required');
}
/** Synchronous operations serialize writes in the main process. A disk lock also rejects other writers. */
export class ProfileStore {
  readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }

  private safe(target: string): void {
    // Check every existing ancestor, including app-data and agents, and do not follow junctions.
    let current = path.resolve(target);
    while (true) {
      try { if (fs.lstatSync(current).isSymbolicLink()) throw new TypeError('Profile symbolic links are not allowed'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const parent = path.dirname(current); if (parent === current) break; current = parent;
    }
  }
  private directory(id: string): string {
    validate({ id, name: 'n', initial: 'i', summary: '', soul: 's', skills: '' });
    const directory = path.join(this.root, id); this.safe(directory); return directory;
  }
  has(id: string): boolean { return fs.existsSync(this.directory(id)); }
  private readFile(directory: string, file: string, optional = false): string {
    const target = path.join(directory, file); this.safe(target);
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.size > (file === 'profile.json' ? 8192 : MAX_TEXT)) throw new TypeError('Invalid profile file size or type');
      return fs.readFileSync(target, 'utf8');
    } catch (error) { if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
  }
  read(id: string): AgentProfile {
    try {
      const directory = this.directory(id);
      if (fs.existsSync(path.join(directory, '.writing'))) throw new TypeError('Incomplete profile save; inspect files before removing .writing');
      const parts = FILES.map(file => this.readFile(directory, file, file === 'SKILL.md'));
      const metadata: unknown = JSON.parse(parts[0]);
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('Invalid profile metadata');
      const input = { ...metadata, soul: parts[1], skills: parts[2] } as ProfileInput;
      validate(input); if (input.id !== id) throw new TypeError('Profile id does not match directory');
      return { id, name: input.name, initial: input.initial, summary: input.summary, soul: input.soul, skills: input.skills, builtin: false, source: 'custom', directory, fingerprint: profileFingerprint(parts) };
    } catch (error) { throw new TypeError(`Invalid profile ${id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  list(strict = true): AgentProfile[] {
    this.safe(this.root);
    if (!fs.existsSync(this.root)) return [];
    const result: AgentProfile[] = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      try { result.push(this.read(entry.name)); } catch (error) { if (strict) throw error; }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Settings never loses valid profiles because one manually edited folder is broken. */
  listReported(): AgentProfile[] {
    const diagnostic = (id: string, directory: string, error: unknown): AgentProfile => ({
      id, name: id === '__profile-storage-error' ? 'Profile storage error' : id, initial: '!', summary: 'Repair the profile files externally, then reload.',
      soul: '', skills: '', builtin: false, source: 'custom', directory, fingerprint: '', error: error instanceof Error ? error.message : String(error),
    });
    try {
      this.safe(this.root);
      if (!fs.existsSync(this.root)) return [];
      return fs.readdirSync(this.root).filter(id => !id.startsWith('.')).map(id => {
        try { return this.read(id); } catch (error) { return diagnostic(id, path.join(this.root, id), error); }
      });
    } catch (error) { return [diagnostic('__profile-storage-error', this.root, error)]; }
  }
  save(input: ProfileInput, expectedFingerprint: string | null, protectedIds: string[]): AgentProfile {
    validate(input);
    if (protectedIds.includes(input.id)) throw new TypeError('Shipped profile is read-only; clone with another id');
    if (expectedFingerprint !== null && (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(expectedFingerprint))) throw new TypeError('Invalid profile fingerprint');
    const directory = this.directory(input.id);
    this.safe(this.root); fs.mkdirSync(this.root, { recursive: true });
    const lock = path.join(this.root, '.save.lock'); this.safe(lock);
    let fd: number;
    try { fd = fs.openSync(lock, 'wx'); } catch { throw new TypeError('Profile save conflict: another writer or stale .save.lock'); }
    try {
      this.safe(directory);
      const exists = fs.existsSync(directory);
      if (expectedFingerprint === null && exists) throw new TypeError('Profile already exists');
      if (expectedFingerprint !== null && (!exists || this.read(input.id).fingerprint !== expectedFingerprint)) throw new TypeError('Profile save conflict: reload the disk version');
      const old = exists ? FILES.map(f => ({ exists: fs.existsSync(path.join(directory, f)), text: this.readFile(directory, f, f === 'SKILL.md') })) : null;
      if (!exists) fs.mkdirSync(directory);
      const { id, name, initial, summary, soul, skills } = input;
      const parts = [JSON.stringify({ id, name, initial, summary }, null, 2) + '\n', soul, skills];
      const marker = path.join(directory, '.writing'); this.safe(marker);
      writeFileAtomic(marker, 'Incomplete save: inspect SOUL.md, SKILL.md and profile.json before removing this marker.\n');
      try {
        FILES.forEach((file, index) => { this.safe(path.join(directory, file)); writeFileAtomic(path.join(directory, file), parts[index]); });
        fs.unlinkSync(marker);
        return this.read(input.id);
      } catch (error) {
        // Roll back ordinary I/O failures. A process crash remains detectable as malformed files.
        FILES.forEach((file, index) => {
          this.safe(path.join(directory, file));
          if (old?.[index].exists) writeFileAtomic(path.join(directory, file), old[index].text);
          else fs.rmSync(path.join(directory, file), { force: true });
        });
        fs.rmSync(marker, { force: true });
        if (!exists) fs.rmdirSync(directory);
        throw error;
      }
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
}
