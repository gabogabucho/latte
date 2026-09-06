import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/contracts';
import { spawnSpecFor } from '../../electron/runtime/commandRunner';
import { TerminalManager, scrubEnv } from '../../electron/runtime/terminalManager';
import { brokenPtyLoader, fakePtyLoader } from './helpers';

const baseInput = {
  workId: 'wrk_demo',
  brandId: 'brd_demo',
  provider: 'claude' as const,
  executable: 'C:\\Users\\me\\.local\\bin\\claude.exe',
  cwd: 'C:\\data\\brands\\brd_demo\\works\\wrk_demo',
};

describe('spawnSpecFor', () => {
  it('routes .cmd shims through cmd.exe with discrete arguments on Windows', () => {
    const spec = spawnSpecFor('C:\\npm\\codex.cmd', ['--version'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });
    expect(spec).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'C:\\npm\\codex.cmd', '--version'] });
  });

  it('runs executables directly everywhere else', () => {
    expect(spawnSpecFor('/usr/local/bin/claude', [], 'linux', {})).toEqual({ file: '/usr/local/bin/claude', args: [] });
    expect(spawnSpecFor('C:\\bin\\claude.exe', [], 'win32', {})).toEqual({ file: 'C:\\bin\\claude.exe', args: [] });
  });
});

describe('scrubEnv', () => {
  it('drops orchestration bindings and keeps everything else', () => {
    const env = scrubEnv({ PATH: 'p', ORCA_RUN: 'r', CLAUDECODE: '1', CLAUDE_CODE_SSE_PORT: '1', ENGRAM_PROJECT: 'other', HOME: 'h', UNDEF: undefined, CODEX_HOME: 'orca-owned', CLAUDE_CONFIG_DIR: 'orca-owned' });
    // Inside an orchestrator (ORCA_*), inherited profile redirections are dropped too.
    expect(env).toEqual({ PATH: 'p', HOME: 'h' });
    // Outside one, a user's own CLAUDE_CONFIG_DIR is respected.
    expect(scrubEnv({ PATH: 'p', CLAUDE_CONFIG_DIR: 'mine' })).toEqual({ PATH: 'p', CLAUDE_CONFIG_DIR: 'mine' });
  });
});

describe('TerminalManager', () => {
  it('reports an honest unavailable state when node-pty cannot load', () => {
    const manager = new TerminalManager({ loadPty: brokenPtyLoader, emit: () => {} });
    expect(manager.availability()).toEqual({ available: false, reason: expect.stringContaining('node-pty') });
    expect(() => manager.start(baseInput)).toThrow(/Terminal backend unavailable/);
    expect(manager.list()).toEqual([]);
  });

  it('streams output and exit events and cleans up the session', () => {
    const events: AgentEvent[] = [];
    const { load, spawned } = fakePtyLoader();
    const manager = new TerminalManager({
      loadPty: load,
      emit: (e) => events.push(e),
      platform: 'win32',
      env: { PATH: 'x', SECRET_TOKEN: 'keep-me-out-of-logs', ComSpec: 'cmd.exe', ORCA_DISPATCH_ID: 'ctx_parent', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' },
    });

    const session = manager.start({ ...baseInput, extraEnv: { ENGRAM_PROJECT: 'latte-brd_demo' } });
    expect(session.provider).toBe('claude');
    expect(session.workId).toBe('wrk_demo');
    expect(manager.list()).toHaveLength(1);

    const pty = spawned[0];
    expect(pty.file).toBe(baseInput.executable);
    expect(pty.options.cwd).toBe(baseInput.cwd);
    expect(pty.options.env.LATTE_WORK_ID).toBe('wrk_demo');
    expect(pty.options.env.TERM).toBe('xterm-256color');
    expect(pty.options.env.SECRET_TOKEN).toBe('keep-me-out-of-logs');
    expect(pty.options.env.ENGRAM_PROJECT).toBe('latte-brd_demo');
    // Never bind the child agent to the session that launched Latte.
    expect(pty.options.env.ORCA_DISPATCH_ID).toBeUndefined();
    expect(pty.options.env.CLAUDECODE).toBeUndefined();
    expect(pty.options.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();

    manager.write(session.id, 'hello\r');
    manager.resize(session.id, 120, 40);
    expect(pty.written).toEqual(['hello\r']);
    expect(pty.resizes).toEqual([[120, 40]]);

    pty.emitData('welcome');
    pty.emitExit(0);
    expect(events).toEqual([
      { sessionId: session.id, type: 'output', data: 'welcome' },
      { sessionId: session.id, type: 'exit', data: '0' },
    ]);
    expect(manager.list()).toEqual([]);
    expect(() => manager.write(session.id, 'late')).toThrow(/Agent session not found/);
  });

  it('uses cmd.exe for .cmd shims and clamps resize values', () => {
    const { load, spawned } = fakePtyLoader();
    const manager = new TerminalManager({ loadPty: load, emit: () => {}, platform: 'win32', env: { ComSpec: 'cmd.exe' } });
    const session = manager.start({ ...baseInput, provider: 'codex', executable: 'C:\\npm\\codex.cmd' });
    expect(spawned[0].file).toBe('cmd.exe');
    expect(spawned[0].args).toEqual(['/c', 'C:\\npm\\codex.cmd']);
    manager.resize(session.id, 5, 9999);
    expect(spawned[0].resizes).toEqual([[20, 300]]);
  });

  it('stops sessions, tolerates double stop and enforces the session cap', () => {
    const { load, spawned } = fakePtyLoader();
    const manager = new TerminalManager({ loadPty: load, emit: () => {}, maxSessions: 2, platform: 'linux', env: {} });
    const a = manager.start({ ...baseInput, executable: '/bin/claude' });
    manager.start({ ...baseInput, executable: '/bin/claude' });
    expect(() => manager.start({ ...baseInput, executable: '/bin/claude' })).toThrow(/Too many open agent sessions/);

    manager.stop(a.id);
    expect(spawned[0].killed).toBe(true);
    expect(() => manager.stop(a.id)).not.toThrow();
    expect(manager.list()).toHaveLength(1);
    manager.stopAll();
    expect(manager.list()).toHaveLength(0);
  });

  it('rejects oversized input chunks', () => {
    const { load } = fakePtyLoader();
    const manager = new TerminalManager({ loadPty: load, emit: () => {}, platform: 'linux', env: {} });
    const session = manager.start({ ...baseInput, executable: '/bin/claude' });
    expect(() => manager.write(session.id, 'x'.repeat(64 * 1024 + 1))).toThrow(/too large/);
  });
});
