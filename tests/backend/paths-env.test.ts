import { describe, expect, it } from 'vitest';
import { ensureUserBinPath } from '../../electron/core/linuxPath';
describe('ensureUserBinPath', () => {
  it('añade ~/.local/bin y /usr/local/bin si faltan, sin duplicar', () => {
    const r = ensureUserBinPath({ PATH: '/usr/bin:/bin', HOME: '/home/u' }, 'linux');
    expect(r.added).toContain('/home/u/.local/bin');
    expect(r.env.PATH?.startsWith('/home/u/.local/bin:/usr/local/bin')).toBe(true);
    expect(ensureUserBinPath(r.env, 'linux').added).toEqual([]);
  });
  it('sin HOME añade solo /usr/local/bin', () => {
    const r = ensureUserBinPath({ PATH: '/usr/bin:/bin' }, 'linux');
    expect(r.added).toEqual(['/usr/local/bin']);
  });
  it('en win32 no toca nada', () => {
    const env = { PATH: 'C:\\x' };
    const r = ensureUserBinPath(env, 'win32');
    expect(r.added).toEqual([]);
    expect(r.env.PATH).toBe('C:\\x');
  });
});
