import { describe, expect, it, vi } from 'vitest';

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  const defaultPath = (actual as typeof actual & { default: typeof actual }).default;
  return {
    ...actual,
    default: { ...defaultPath, join: actual.win32.join },
  };
});

import { ensureUserBinPath } from '../../electron/core/linuxPath';

describe('ensureUserBinPath', () => {
  it.each(['linux', 'darwin'] as const)(
    'construye PATH POSIX en %s aunque el host use path.win32.join',
    (platform) => {
      const r = ensureUserBinPath(
        { PATH: '/usr/bin:/bin', HOME: '/home/u' },
        platform,
      );
      expect(r.added).toEqual(['/home/u/.local/bin', '/usr/local/bin']);
      expect(r.env.PATH).toBe(
        '/home/u/.local/bin:/usr/local/bin:/usr/bin:/bin',
      );
      expect(ensureUserBinPath(r.env, platform).added).toEqual([]);
    },
  );
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
