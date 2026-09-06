import { describe, expect, it } from 'vitest';
import { RuntimeDetector } from '../../electron/runtime/detect';
import { PROVIDERS, isProvider } from '../../electron/runtime/providers';
import { fakeRunner } from './helpers';

describe('providers allowlist', () => {
  it('only accepts the three known CLIs', () => {
    expect(PROVIDERS).toEqual(['claude', 'codex', 'opencode']);
    expect(isProvider('claude')).toBe(true);
    expect(isProvider('bash')).toBe(false);
    expect(isProvider('claude; rm -rf /')).toBe(false);
  });
});

describe('RuntimeDetector', () => {
  it('finds CLIs on Windows, prefers .exe over .cmd and reports versions', async () => {
    const runner = fakeRunner((file, args) => {
      if (file === 'where.exe') {
        if (args[0] === 'claude') return { code: 0, stdout: 'C:\\Users\\me\\.local\\bin\\claude.exe\r\n' };
        if (args[0] === 'codex') return { code: 0, stdout: 'C:\\npm\\codex\r\nC:\\npm\\codex.cmd\r\n' };
        return { code: 1, stderr: 'INFO: Could not find files' };
      }
      if (args[0] === '--version') {
        if (file.includes('claude')) return { code: 0, stdout: '2.1.0 (Claude Code)\n' };
        if (file.includes('codex')) return { code: 0, stdout: 'codex-cli 0.50.0\n' };
      }
      return { code: 1 };
    });
    const detector = new RuntimeDetector({
      runner,
      terminalAvailability: () => ({ available: true }),
      platform: 'win32',
      env: {},
    });

    const status = await detector.status();
    expect(status).toEqual([
      { provider: 'claude', available: true, detail: expect.stringContaining('Claude Code 2.1.0 (Claude Code)') },
      { provider: 'codex', available: true, detail: expect.stringContaining('C:\\npm\\codex.cmd') },
      { provider: 'opencode', available: false, detail: 'OpenCode not found on PATH' },
    ]);
    expect((await detector.resolve('codex'))?.executable).toBe('C:\\npm\\codex.cmd');
    expect(runner.calls.every((c) => c.args.every((a) => !a.includes(';')))).toBe(true);
  });

  it('marks providers unavailable when the terminal backend is missing, keeping the reason', async () => {
    const runner = fakeRunner((file) => (file === 'which' ? { code: 0, stdout: '/usr/local/bin/claude\n' } : { code: 0, stdout: '1.0.0\n' }));
    const detector = new RuntimeDetector({
      runner,
      terminalAvailability: () => ({ available: false, reason: 'node-pty binary missing' }),
      platform: 'linux',
      env: {},
    });
    const [claude] = await detector.status();
    expect(claude.available).toBe(false);
    expect(claude.detail).toMatch(/found, but the terminal backend is unavailable: node-pty binary missing/);
  });

  it('caches lookups within the ttl and refreshes after invalidate', async () => {
    let hits = 0;
    const runner = fakeRunner((file) => {
      if (file === 'which') { hits += 1; return { code: 0, stdout: '/bin/claude\n' }; }
      return { code: 0, stdout: 'v\n' };
    });
    const detector = new RuntimeDetector({ runner, terminalAvailability: () => ({ available: true }), platform: 'linux', env: {}, ttlMs: 60_000 });
    await detector.status();
    await detector.status();
    expect(hits).toBe(3);
    detector.invalidate();
    await detector.status();
    expect(hits).toBe(6);
  });

  it('treats timeouts and spawn errors as not found', async () => {
    const runner = fakeRunner(() => ({ code: null, timedOut: true, error: 'ETIMEDOUT' }));
    const detector = new RuntimeDetector({ runner, terminalAvailability: () => ({ available: true }), platform: 'linux', env: {} });
    expect((await detector.status()).every((s) => !s.available)).toBe(true);
  });
});
