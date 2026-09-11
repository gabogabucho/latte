import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { killProcessTree, spawnInOwnProcessGroup } from '../../electron/core/processTree';
import { OpenCodeServer } from '../../electron/opencode/server';

function fakeChild(pid = 4242) {
  return {
    pid,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
    once: vi.fn(),
  } as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn>; once: ReturnType<typeof vi.fn> };
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function exists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForGone(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (exists(pid)) {
    if (Date.now() >= deadline) throw new Error(`process ${pid} remained alive`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('process tree ownership', () => {
  it.each([
    ['linux', true],
    ['darwin', true],
    ['win32', undefined],
  ] as const)('sets detached only for POSIX callers on %s', (platform, detached) => {
    const child = fakeChild();
    const spawnSpy = vi.fn((_file: string, _args: string[], _options: SpawnOptions) => child);
    const spawnImpl = spawnSpy as unknown as typeof spawn;
    const options: SpawnOptions = { cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };

    expect(spawnInOwnProcessGroup(spawnImpl, 'runtime', ['serve'], options, platform)).toBe(child);

    expect(spawnSpy).toHaveBeenCalledOnce();
    const calledOptions = spawnSpy.mock.calls[0][2] as SpawnOptions;
    expect(calledOptions).toMatchObject(options);
    expect(calledOptions.detached).toBe(detached);
  });
});

describe('OpenCodeServer process ownership', () => {
  it.each([
    ['linux', true],
    ['win32', undefined],
  ] as const)('launches through the shared process-group wrapper on %s', async (platform, detached) => {
    let options: Parameters<typeof spawn>[2];
    const server = new OpenCodeServer({
      executable: '/definitely/missing/opencode',
      cwd: process.cwd(),
      env: {},
      platform,
      startupTimeoutMs: 100,
      spawnImpl: ((...args: Parameters<typeof spawn>) => {
        options = args[2];
        throw new Error('spawn captured');
      }) as unknown as typeof spawn,
    });

    await expect(server.ensure()).rejects.toThrow(/spawn captured/);
    expect(options!.detached).toBe(detached);
  });
});

describe('killProcessTree POSIX group kill', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends TERM then an uncancelled KILL to the owned process group', () => {
    const child = fakeChild(4242);
    const kill = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);

    killProcessTree(child, 'linux');
    const exitListener = child.once.mock.calls.find(([event]) => event === 'exit')?.[1] as (() => void) | undefined;
    exitListener?.();
    vi.advanceTimersByTime(3_000);

    expect(kill).toHaveBeenNthCalledWith(1, -4242, 'SIGTERM');
    expect(kill).toHaveBeenNthCalledWith(2, -4242, 'SIGKILL');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('falls back to the child only when the process group never existed', () => {
    const child = fakeChild(4243);
    vi.spyOn(process, 'kill').mockImplementation(() => { throw errno('ESRCH'); });

    expect(() => killProcessTree(child, 'linux')).not.toThrow();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    vi.advanceTimersByTime(3_000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('treats ESRCH during group escalation as idempotent', () => {
    const child = fakeChild(4244);
    vi.spyOn(process, 'kill')
      .mockImplementationOnce((() => true) as typeof process.kill)
      .mockImplementationOnce(() => { throw errno('ESRCH'); });

    killProcessTree(child, 'darwin');
    vi.advanceTimersByTime(3_000);

    expect(child.kill).not.toHaveBeenCalled();
  });

  it('does not signal a POSIX process group on Windows', () => {
    const child = fakeChild(4245);
    const kill = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);

    killProcessTree(child, 'win32');

    expect(kill).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe.skipIf(process.platform === 'win32')('real POSIX process tree', () => {
  it('kills a detached child and its TERM-resistant grandchild', async () => {
    const grandchildSource = [
      "process.on('SIGTERM', () => {});",
      "process.stdout.write('ready\\n');",
      'setInterval(() => {}, 1_000);',
    ].join('');
    const childSource = [
      "const { spawn } = require('node:child_process');",
      `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: ['ignore', 'pipe', 'ignore'] });`,
      "grandchild.stdout.once('data', () => process.stdout.write(JSON.stringify({ child: process.pid, grandchild: grandchild.pid }) + '\\n'));",
      'setInterval(() => {}, 1_000);',
    ].join('');
    const child = spawnInOwnProcessGroup(
      spawn,
      process.execPath,
      ['-e', childSource],
      { stdio: ['ignore', 'pipe', 'pipe'] },
      process.platform,
    );
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    let childPid: number | undefined = child.pid;
    let grandchildPid: number | undefined;

    try {
      const chunks: Buffer[] = [];
      const pids = await new Promise<{ child: number; grandchild: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for child PIDs')), 2_000);
        child.stdout?.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          const line = Buffer.concat(chunks).toString('utf8').split('\n')[0];
          if (!line) return;
          clearTimeout(timer);
          resolve(JSON.parse(line) as { child: number; grandchild: number });
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => reject(new Error(`child exited before announcing PIDs (${code ?? signal})`)));
      });
      childPid = pids.child;
      grandchildPid = pids.grandchild;
      expect(exists(childPid)).toBe(true);
      expect(exists(grandchildPid)).toBe(true);

      killProcessTree(child, process.platform);

      await waitForGone(childPid, 2_000);
      expect(exists(grandchildPid)).toBe(true);
      await waitForGone(grandchildPid, 5_000);
    } finally {
      if (childPid !== undefined) {
        try { process.kill(-childPid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
      for (const pid of [grandchildPid, childPid]) {
        if (pid === undefined) continue;
        try { process.kill(pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
      child.stdin?.destroy();
      child.stdout?.removeAllListeners();
      child.stdout?.destroy();
      child.stderr?.removeAllListeners();
      child.stderr?.destroy();
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1_000))]);
      child.removeAllListeners();
    }
  }, 10_000);
});
