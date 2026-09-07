import fs from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ProfileStore } from '../../electron/agents/profiles';
import { RoleCatalog } from '../../electron/agents/roles';
import { makeTempDir, removeDir } from './helpers';

const input = { id: 'coffee-editor', name: 'Coffee', initial: 'C', summary: 'Campaigns', soul: 'SOUL UNIQUE', skills: 'SKILL UNIQUE' };
it('roundtrips, rejects unsafe inputs, conflicts and malformed disk entries, and refreshes prompts', () => {
  const dir = makeTempDir();
  try {
    const store = new ProfileStore(path.join(dir, 'agents'));
    const catalog = new RoleCatalog(null, store);
    const created = catalog.saveProfile(input, null);
    expect(catalog.promptFor(input.id)).toContain(input.skills);
    expect(catalog.promptFor(input.id)).toContain(input.soul);
    expect(new RoleCatalog(null, new ProfileStore(path.join(dir, 'agents'))).listProfiles()).toContainEqual(created);
    for (const id of ['../escape', 'con', 'a/b', 'assistant', 'COM1', 'x'.repeat(60)]) expect(() => catalog.saveProfile({ ...input, id }, null)).toThrow();
    expect(() => catalog.saveProfile({ ...input, soul: 'x'.repeat(300000) }, created.fingerprint)).toThrow();
    expect(() => catalog.saveProfile({ ...input, name: 42 } as never, created.fingerprint)).toThrow();
    const updated = catalog.saveProfile({ ...input, soul: 'UPDATED' }, created.fingerprint);
    expect(catalog.promptFor(input.id)).toContain('UPDATED');
    expect(() => catalog.saveProfile(input, created.fingerprint)).toThrow(/conflict/i);
    fs.writeFileSync(path.join(updated.directory!, 'profile.json'), '{}');
    expect(catalog.list()[0].id).toBe('assistant');
    expect(() => catalog.get(input.id)).toThrow(/profile/i);
    expect(catalog.listProfiles().find(p => p.id === input.id)?.error).toMatch(/profile/i);
    expect(catalog.listProfiles()[0].id).toBe('assistant');
  } finally { removeDir(dir); }
});

it('reports interrupted multi-file saves rather than combining two profiles', () => {
  const dir = makeTempDir();
  try {
    const store = new ProfileStore(path.join(dir, 'agents'));
    const p = store.save(input, null, []);
    fs.writeFileSync(path.join(p.directory!, '.writing'), 'incomplete');
    expect(() => store.read(input.id)).toThrow(/incomplete/i);
  } finally { removeDir(dir); }
});

it('never silently uses a neutral prompt for a deleted custom profile', () => {
  const dir = makeTempDir();
  try {
    const catalog = new RoleCatalog(null, new ProfileStore(path.join(dir, 'agents')));
    expect(() => catalog.promptFor('deleted-profile')).toThrow(/unavailable/i);
  } finally { removeDir(dir); }
});

it('rejects directory symlink escapes', () => {
  const dir = makeTempDir();
  try {
    fs.mkdirSync(path.join(dir, 'outside'));
    fs.symlinkSync(path.join(dir, 'outside'), path.join(dir, 'agents'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => new ProfileStore(path.join(dir, 'agents')).save(input, null, [])).toThrow(/symbolic|symlink/i);
    expect(fs.readdirSync(path.join(dir, 'outside'))).toEqual([]);
  } finally { removeDir(dir); }
});

it('rolls back a failed multi-file write and rejects concurrent writers', () => {
  const dir = makeTempDir();
  try {
    const store = new ProfileStore(path.join(dir, 'agents'));
    const p = store.save(input, null, []);
    const rename = fs.renameSync;
    let failed = false;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (!failed && String(to).endsWith('SKILL.md')) { failed = true; throw new Error('injected disk failure'); }
      rename(from, to);
    });
    try { expect(() => store.save({ ...input, soul: 'CHANGED' }, p.fingerprint, [])).toThrow(/injected/); }
    finally { spy.mockRestore(); }
    expect(store.read(input.id)).toEqual(p);
    fs.writeFileSync(path.join(dir, 'agents', '.save.lock'), 'other writer');
    expect(() => store.save(input, p.fingerprint, [])).toThrow(/conflict/i);
    expect(store.read(input.id)).toEqual(p);
  } finally { removeDir(dir); }
});

it('shows a root diagnostic while preserving shipped profiles', () => {
  const dir = makeTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'agents'), 'not a directory');
    const catalog = new RoleCatalog(null, new ProfileStore(path.join(dir, 'agents')));
    expect(catalog.list().map(p => p.id)).toEqual(['assistant']);
    expect(catalog.listProfiles()).toMatchObject([{ id: 'assistant' }, { id: '__profile-storage-error', error: expect.any(String) }]);
  } finally { removeDir(dir); }
});
