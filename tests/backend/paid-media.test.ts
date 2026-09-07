import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ProfileStore } from '../../electron/agents/profiles';
import { RoleCatalog } from '../../electron/agents/roles';
import { loadInstructionPack } from '../../electron/workspace/packs';
import { makeTempDir, removeDir } from './helpers';

const packsDir = path.resolve(__dirname, '../../packs');
const pack = loadInstructionPack(packsDir, 'marketing-core');
const catalog = new RoleCatalog(pack);

it('loads Paid Media as a shipped, cloneable profile with the full role body', () => {
  const profile = catalog.listProfiles().find(p => p.id === 'paid-media');
  expect(profile).toMatchObject({ name: 'Paid Media', initial: 'P', source: 'builtin', directory: null });
  expect(catalog.list().filter(p => p.id === 'paid-media')).toHaveLength(1);
  expect(profile?.soul).toContain('confirming tool result');
  const raw = fs.readFileSync(path.join(packsDir, 'marketing-core/roles/paid-media.md'), 'utf8');
  expect(raw.length).toBeLessThan(8_000); // loader truncates longer files
  const dir = makeTempDir();
  try {
    const editable = new RoleCatalog(pack, new ProfileStore(path.join(dir, 'agents')));
    const input = { id: 'paid-media', name: profile!.name, initial: 'P', summary: profile!.summary, soul: profile!.soul, skills: profile!.skills };
    expect(() => editable.saveProfile(input, null)).toThrow();
    editable.saveProfile({ ...input, id: 'my-paid-media' }, null);
    expect(editable.promptFor('my-paid-media')).toContain(profile!.soul);
  } finally { removeDir(dir); }
});

it('composes the marketing base before Paid Media, without the supplied-data-only Analyst role', () => {
  const prompt = catalog.promptFor('paid-media');
  expect(prompt).toContain('acting as: Paid Media');
  expect(prompt.indexOf('marketing, not on software')).toBeLessThan(prompt.indexOf('# Role: Paid Media'));
  expect(prompt).toContain(catalog.get('paid-media')!.instructions);
  expect(prompt).not.toContain('# Role: Analyst');
  expect(catalog.promptFor('assistant')).not.toContain('# Role: Paid Media');
});

// Lexical contract checks: instructions reach the prompt; NOT proof of model obedience or expertise.
it.each([
  /brand and exact ad account ID/,
  /Brand context is not a security boundary/,
  /date range and comparison period[\s\S]*conversion event\/definition[\s\S]*currency[\s\S]*timezone[\s\S]*attribution window\/model/,
  /only available, authorized tools/,
  /Do not assume a Meta MCP[\s\S]*read-only/,
  /supplied exports\/files[\s\S]*never.*invent metrics/i,
  /\*\*facts\*\*[\s\S]*\*\*calculations\*\*[\s\S]*\*\*hypotheses\*\*[\s\S]*\*\*recommendations\*\*/,
  /zero denominator[\s\S]*undefined\/unavailable/,
  /recompute ratios from compatible totals[\s\S]*non-additive metrics/,
  /correlation is not proof of causation/,
  /Reviewing or analyzing is not authorization to modify/,
  /explicit scoped authorization[\s\S]*actual tool permission/,
  /finding \| evidence\/source \| impact \| proposed action \| uncertainty \| next validation/,
])('includes Paid Media scope and safety contract: %s', (pattern) => {
  expect(catalog.get('paid-media')!.instructions).toMatch(pattern);
});
