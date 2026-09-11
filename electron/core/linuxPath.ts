import path from 'node:path';

type Env = Record<string, string | undefined>;

export function ensureUserBinPath(
  env: Env,
  platform: NodeJS.Platform,
): { env: Env; added: string[] } {
  if (platform === 'win32') return { env, added: [] };
  const home = env.HOME;
  // POSIX on purpose: the caller already returned for win32, and the host's
  // `path` is `path.win32` when the Windows test suite exercises this branch.
  const candidates = home
    ? [path.posix.join(home, '.local/bin'), '/usr/local/bin']
    : ['/usr/local/bin'];
  const parts = (env.PATH ?? '').split(':').filter(Boolean);
  const added = candidates.filter((c) => !parts.includes(c));
  if (added.length === 0) return { env, added };
  return { env: { ...env, PATH: [...added, ...parts].join(':') }, added };
}
