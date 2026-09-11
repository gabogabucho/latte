import { execFile, type ChildProcess, type SpawnOptions, type spawn } from 'node:child_process';

/**
 * Spawns a runtime as the leader of its own POSIX process group. Windows uses
 * taskkill for tree termination, so detached must remain unset there.
 */
export function spawnInOwnProcessGroup(
  spawnImpl: typeof spawn,
  file: string,
  args: string[],
  options: SpawnOptions,
  platform: NodeJS.Platform = process.platform,
): ChildProcess {
  if (platform === 'win32') {
    const { detached: _detached, ...windowsOptions } = options;
    return spawnImpl(file, args, windowsOptions);
  }
  return spawnImpl(file, args, { ...options, detached: true });
}

/** Stops a child and the descendants in the process tree it owns. */
export function killProcessTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  const pid = child.pid;
  if (pid === undefined) return;

  if (platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    } catch {
      try { child.kill(); } catch { /* already gone */ }
    }
    return;
  }

  let groupExisted = true;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if (!isEsrch(error)) return;
    groupExisted = false;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }

  const timer = setTimeout(() => {
    if (!groupExisted) {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      return;
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (!isEsrch(error)) return;
    }
  }, 3_000);
  timer.unref();
}

function isEsrch(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ESRCH';
}
