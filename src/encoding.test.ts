import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = ['src', 'electron', 'shared', 'tests'];
const extensions = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.html', '.css']);
const mojibake = /Ã.|Â[¿¡·]|â(?:€|€™|€œ)|ï¿½/;
function files(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? files(target) : extensions.has(path.extname(target)) ? [target] : [];
  });
}
describe('UTF-8 source', () => {
  it('contains no common mojibake sequences', () => {
    const broken = roots.flatMap(files).filter(file => !file.endsWith('encoding.test.ts') && mojibake.test(fs.readFileSync(file, 'utf8')));
    expect(broken).toEqual([]);
  });
});
