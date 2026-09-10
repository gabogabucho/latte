import { describe, expect, it } from 'vitest';
import { ensureUserBinPath } from '../../electron/core/linuxPath';
describe('ensureUserBinPath', () => {
  it('añade ~/.local/bin y /usr/local/bin si faltan, sin duplicar', () => {
    const r = ensureUserBinPath({ PATH: '/usr/bin:/bin', HOME: '/home/u' }, 'linux');
    expect(r.added).toContain('/home/u/.local/bin');
    expect(ensureUserBinPath(r.env, 'linux').added).toEqual([]);
  });
  it('en win32 no toca nada', () => {
    expect(ensureUserBinPath({ PATH: 'C:\\x' }, 'win32').added).toEqual([]);
  });
});
