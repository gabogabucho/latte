import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { killTree } from '../../electron/opencode/server';

function fakeChild(pid = 4242) {
  return {
    pid,
    exitCode: null,
    kill: vi.fn(() => true),
    once: vi.fn(),
  } as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn>; once: ReturnType<typeof vi.fn> };
}

describe('killTree POSIX group kill (T2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('(a) POSIX llama process.kill(-pid, SIGTERM)', () => {
    const child = fakeChild(4242);
    const spy = vi.spyOn(process, 'kill').mockImplementation((() => true) as unknown as typeof process.kill);
    killTree(child, 'linux');
    expect(spy).toHaveBeenCalledWith(-4242, 'SIGTERM');
  });

  it('(b) si process.kill lanza → fallback child.kill(SIGTERM)', () => {
    const child = fakeChild(4243);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });
    killTree(child, 'linux');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('(c) win32 no llama process.kill (usa taskkill)', () => {
    const child = fakeChild(4244);
    const spy = vi.spyOn(process, 'kill').mockImplementation((() => true) as unknown as typeof process.kill);
    killTree(child, 'win32');
    expect(spy).not.toHaveBeenCalled();
  });
});
