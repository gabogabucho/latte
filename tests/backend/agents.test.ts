import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../shared/contracts';
import { AccountStore, SYSTEM_ACCOUNT_ID } from '../../electron/agents/accounts';
import { ClaudeChatAdapter, CLAUDE_HEADLESS_ARGS, FOLDER_TOOLS } from '../../electron/agents/claude/claudeAdapter';
import { fakeRunner, makeBackend, makeTempDir, removeDir, type TestBackend } from './helpers';
import { startFakeOpenCode, type FakeOpenCode } from './fakeOpenCode';

const FAKE_CLAUDE = path.resolve(__dirname, 'fakeClaude.cjs');

async function waitFor(check: () => boolean, timeoutMs = 6_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function fakeClaudeAdapter(events: ChatEvent[], extra: Partial<ConstructorParameters<typeof ClaudeChatAdapter>[0]> = {}) {
  return new ClaudeChatAdapter({
    resolveExecutable: async () => ({ executable: process.execPath, version: '2.1.263' }),
    emit: (e) => events.push(e),
    accountEnv: (accountId): Record<string, string> => (accountId && accountId !== SYSTEM_ACCOUNT_ID ? { CLAUDE_CONFIG_DIR: `C:\\managed\\${accountId}` } : {}),
    // Prepend the fake script so `node <args>` becomes `node fakeClaude.cjs <args>`.
    spawnImpl: ((file: string, args: string[], options: Parameters<typeof spawn>[2]) => spawn(file, [FAKE_CLAUDE, ...args], options)) as typeof spawn,
    platform: 'linux',
    env: { PATH: process.env.PATH ?? '', CLAUDECODE: '1', ORCA_RUN: 'x' },
    ...extra,
  });
}

describe('AccountStore', () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => removeDir(dir));

  it('creates managed profile directories, lists them and points the CLI at them', () => {
    const store = new AccountStore({ root: path.join(dir, 'accounts'), runner: fakeRunner(() => ({ code: 0 })), resolveExecutable: async () => null });
    const created = store.create('claude', '  Cuenta   agencia ');
    expect(created.label).toBe('Cuenta agencia');
    expect(created.id).toMatch(/^acc_[a-f0-9]{16}$/);
    expect(fs.existsSync(path.join(dir, 'accounts', 'claude', created.id, 'latte-account.json'))).toBe(true);
    expect(store.list('claude').map((a) => a.id)).toEqual([created.id]);
    expect(store.list('codex')).toEqual([]);
    expect(store.envFor('claude', created.id)).toEqual({ CLAUDE_CONFIG_DIR: path.join(dir, 'accounts', 'claude', created.id) });
    expect(store.envFor('codex', created.id)).toEqual({ CODEX_HOME: path.join(dir, 'accounts', 'codex', created.id) });
    expect(store.envFor('claude', SYSTEM_ACCOUNT_ID)).toEqual({});
    expect(store.envFor('claude', null)).toEqual({});
    store.remove('claude', created.id);
    expect(store.list('claude')).toEqual([]);
    expect(() => store.dir('claude', '../escape')).toThrow(/Invalid account id/);
    expect(() => store.create('claude', '')).toThrow(/1-80/);
  });

  it('probes login state through the CLIs without touching credentials', async () => {
    const runner = fakeRunner((file, args) => {
      if (file.includes('claude') && args[0] === 'auth') {
        return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'me@example.com' }) };
      }
      if (file.includes('codex') && args[0] === 'login') return { code: 0, stdout: 'Logged in using ChatGPT\n' };
      return { code: 1 };
    });
    const store = new AccountStore({
      root: path.join(dir, 'accounts'),
      runner,
      resolveExecutable: async (runtime) => (runtime === 'claude' ? 'C:\\bin\\claude.exe' : 'C:\\bin\\codex.exe'),
      env: { CLAUDECODE: '1' },
    });
    const managed = store.create('claude', 'Segunda');
    const claude = await store.describe('claude');
    expect(claude.map((a) => [a.id, a.system, a.loggedIn])).toEqual([[SYSTEM_ACCOUNT_ID, true, true], [managed.id, false, true]]);
    expect(claude[0].detail).toBe('Plan max · claude.ai · me@example.com');
    // Managed accounts are probed with their own profile directory; nothing leaks from the parent session.
    const managedCall = runner.calls.find((c) => c.args[0] === 'auth');
    expect(managedCall).toBeDefined();
    const codex = await store.describe('codex');
    expect(codex[0]).toMatchObject({ loggedIn: true, detail: 'Logged in using ChatGPT' });
  });

  it('reports installed-but-logged-out and missing CLIs honestly', async () => {
    const runner = fakeRunner(() => ({ code: 0, stdout: JSON.stringify({ loggedIn: false }) }));
    const store = new AccountStore({ root: path.join(dir, 'accounts'), runner, resolveExecutable: async (runtime) => (runtime === 'claude' ? 'C:\\bin\\claude.exe' : null) });
    expect((await store.describe('claude'))[0]).toMatchObject({ loggedIn: false, detail: 'Sin sesión iniciada' });
    expect((await store.describe('codex'))[0]).toMatchObject({ loggedIn: false, detail: 'Codex no está instalado' });
  });
});

describe('ClaudeChatAdapter against a fake Claude Code', () => {
  let events: ChatEvent[];
  let adapter: ClaudeChatAdapter;
  let dir: string;

  beforeEach(() => {
    events = [];
    dir = makeTempDir();
    adapter = fakeClaudeAdapter(events);
  });

  afterEach(() => {
    adapter.shutdown();
    removeDir(dir);
  });

  it('streams a reply, learns the session id and completes the turn', async () => {
    const seen: string[] = [];
    adapter = fakeClaudeAdapter(events, { onSessionId: (chatId, sid) => seen.push(`${chatId}:${sid}`) });
    const { session, runtimeSessionId } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 'Marca · Uno', label: 'Claude Code · mi sesión', accountId: SYSTEM_ACCOUNT_ID });
    expect(session).toMatchObject({ provider: 'claude', accountId: SYSTEM_ACCOUNT_ID, label: 'Claude Code · mi sesión', resumed: false });
    expect(runtimeSessionId).toBe('');

    await adapter.send(session.id, 'Hola Claude');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));

    expect(seen).toEqual([`${session.id}:sess-fake-0001`]);
    const messages = adapter.listMessages(session.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].parts[0]).toMatchObject({ type: 'text', text: 'Hola Claude' });
    expect(messages[1].parts[0]).toMatchObject({ type: 'text', text: 'Echo: Hola Claude' });
    expect(messages[1].completed).toBe(true);
    expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === 'status' && e.status === 'busy')).toBe(true);
    await expect(adapter.send(session.id, 'x'.repeat(10))).resolves.toBeUndefined();
  });

  it('does not print the answer twice when the model reasons before writing', async () => {
    // The real CLI numbers streamed blocks by their place in the turn, while the
    // final `assistant` message numbers them inside its own array. With a
    // thinking block first, the text streams at index 1 and arrives at index 0.
    adapter = fakeClaudeAdapter(events);
    const { session } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 'Marca · Uno', label: 'Claude', accountId: SYSTEM_ACCOUNT_ID });
    await adapter.send(session.id, 'razonar y contestar');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));

    const parts = adapter.listMessages(session.id).flatMap((m) => m.parts);
    expect(parts.filter((p) => p.type === 'text' && p.text.includes('actividad real'))).toHaveLength(1);
    expect(parts.filter((p) => p.type === 'reasoning')).toHaveLength(1);
  });


  it('only grants the folder when the human asked for it, and only for the folder', async () => {
    // Measured against a real Claude Code before wiring this: these patterns
    // stop the prompt for a write inside the folder and keep asking for one
    // above it, so the grant a marketer gives cannot leak past their work.
    const argvOf = async (input: { trustedFolder?: boolean }) => {
      const { session } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Claude', accountId: null, ...input });
      await adapter.send(session.id, 'dame el argv');
      await waitFor(() => adapter.listMessages(session.id).some((m) => m.parts.some((p) => p.type === 'text' && p.text.startsWith('ARGV'))));
      const text = adapter.listMessages(session.id).flatMap((m) => m.parts).find((p) => p.type === 'text' && p.text.startsWith('ARGV')) as { text: string };
      adapter.stop(session.id);
      return text.text;
    };

    const withoutGrant = await argvOf({});
    expect(withoutGrant).not.toContain('--allowedTools');
    expect(withoutGrant).toContain('--permission-mode manual');

    const withGrant = await argvOf({ trustedFolder: true });
    expect(withGrant).toContain('--allowedTools Read(./**) Write(./**) Edit(./**)');
    // Still manual: the grant narrows what gets asked, it does not turn asking off.
    expect(withGrant).toContain('--permission-mode manual');
    expect(withGrant).not.toContain('bypassPermissions');
    expect(FOLDER_TOOLS.every((pattern) => pattern.includes('(./'))).toBe(true);
  });

  it('asks the user for tool permission over stdio and honours the decision', async () => {
    const { session } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Claude', accountId: null });
    await adapter.send(session.id, 'Please write the file');
    await waitFor(() => events.some((e) => e.type === 'permission'));
    const permission = events.find((e) => e.type === 'permission');
    expect(permission).toMatchObject({ request: { permission: 'Write', patterns: ['brief.md'], title: 'brief.md', always: ['session'] } });
    const toolBefore = adapter.listMessages(session.id)[1].parts.find((p) => p.type === 'tool');
    expect(toolBefore).toMatchObject({ tool: 'Write', status: 'running' });

    await expect(adapter.replyPermission(session.id, 'req_nope', 'once')).rejects.toThrow(/Permission request not found/);
    await adapter.replyPermission(session.id, (permission as { request: { id: string } }).request.id, 'once');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));
    const toolAfter = adapter.listMessages(session.id)[1].parts.find((p) => p.type === 'tool');
    expect(toolAfter).toMatchObject({ status: 'completed', output: expect.stringContaining('File created') });
    expect(events.some((e) => e.type === 'permission-resolved')).toBe(true);
  });

  it('marks a rejected tool as error and still completes the turn', async () => {
    const { session } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Claude', accountId: null });
    await adapter.send(session.id, 'write it');
    await waitFor(() => events.some((e) => e.type === 'permission'));
    await adapter.replyPermission(session.id, (events.find((e) => e.type === 'permission') as { request: { id: string } }).request.id, 'reject');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));
    const tool = adapter.listMessages(session.id)[1].parts.find((p) => p.type === 'tool');
    expect(tool).toMatchObject({ status: 'error', error: expect.stringContaining('declined') });
  });

  it('interrupts a running turn and surfaces failures and process exit', async () => {
    const { session } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Claude', accountId: null });
    await adapter.send(session.id, 'be slow');
    await waitFor(() => events.some((e) => e.type === 'delta'));
    await expect(adapter.send(session.id, 'again')).rejects.toThrow(/still working/);
    await adapter.abort(session.id);
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));

    await adapter.send(session.id, 'please fail');
    await waitFor(() => events.some((e) => e.type === 'error'));
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: 'Simulated failure' });

    adapter.stop(session.id);
    expect(events.at(-1)).toMatchObject({ type: 'closed', reason: 'stopped' });
    expect(adapter.owns(session.id)).toBe(false);
  });

  it('passes resume, model and the managed profile through to the CLI', async () => {
    const spawned: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
    adapter = fakeClaudeAdapter(events, {
      spawnImpl: ((file: string, args: string[], options: { env?: Record<string, string> }) => {
        spawned.push({ args, env: options.env ?? {} });
        return spawn(file, [FAKE_CLAUDE, ...args], options as Parameters<typeof spawn>[2]);
      }) as typeof spawn,
    });
    const { session, runtimeSessionId } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Claude · agencia', accountId: 'acc_0123456789abcdef', previousSessionId: 'sess-old', model: 'opus', extraEnv: { ENGRAM_PROJECT: 'latte-brd_1' } });
    expect(session.resumed).toBe(true);
    expect(runtimeSessionId).toBe('sess-old');
    expect(spawned[0].args).toEqual([...CLAUDE_HEADLESS_ARGS, '--resume', 'sess-old', '--model', 'opus']);
    expect(spawned[0].env.CLAUDE_CONFIG_DIR).toBe('C:\\managed\\acc_0123456789abcdef');
    expect(spawned[0].env.ENGRAM_PROJECT).toBe('latte-brd_1');
    expect(spawned[0].env.CLAUDECODE).toBeUndefined();
    expect(spawned[0].env.ORCA_RUN).toBeUndefined();
  });
});

describe('AgentHub through the service', () => {
  let fake: FakeOpenCode;
  let b: TestBackend;

  beforeEach(async () => {
    fake = await startFakeOpenCode();
    b = await makeBackend({
      chatEndpoint: fake.endpoint,
      runner: fakeRunner((file, args) => {
        if (file === 'where.exe' || file === 'which') return { code: 0, stdout: `C:\\bin\\${args[0]}.exe\n` };
        if (args[0] === 'auth' && args[1] === 'status') return { code: 0, stdout: JSON.stringify({ loggedIn: true, subscriptionType: 'max' }) };
        if (args[0] === 'login' && args[1] === 'status') return { code: 0, stdout: 'Not logged in' };
        return { code: 0, stdout: '1.0.0\n' };
      }),
      emitChat: () => {},
    });
  });

  afterEach(async () => {
    b.cleanup();
    await fake.close();
  });

  it('defaults to OpenCode and lets the user pin a primary agent once', async () => {
    expect(await b.service.getPrimaryAgent()).toBeNull();
    const brand = await b.service.createBrand('Casa');
    const work = await b.service.createWork(brand.id, 'Trabajo');
    const first = await b.service.startChat(work.id);
    expect(first).toMatchObject({ provider: 'opencode', label: 'OpenCode · modelo por defecto' });
    await b.service.stopChat(first.id);

    const primary = await b.service.setPrimaryAgent({ runtime: 'opencode', model: 'fake-provider/fake-model', accountId: null });
    expect(primary).toEqual({ runtime: 'opencode', model: 'fake-provider/fake-model', accountId: null, label: 'OpenCode · fake-provider/fake-model' });
    const second = await b.service.startChat(work.id);
    expect(second.model).toBe('fake-provider/fake-model');
    await b.service.stopChat(second.id);

    const codex = await b.service.setPrimaryAgent({ runtime: 'codex', model: null, accountId: null });
    expect(codex).toMatchObject({ runtime: 'codex', accountId: 'system', label: 'Codex · mi sesión' });
    await expect(b.service.setPrimaryAgent({ runtime: 'bash' as never, model: null, accountId: null })).rejects.toThrow(/Unknown runtime/);
  });

  it('lists subscription runtimes with accounts and manages managed profiles', async () => {
    const runtimes = await b.service.listAgentRuntimes();
    expect(runtimes.map((r) => r.runtime)).toEqual(['claude', 'codex']);
    expect(runtimes[0]).toMatchObject({ installed: true, accounts: [{ id: SYSTEM_ACCOUNT_ID, system: true, loggedIn: true }] });
    expect(runtimes[1].accounts[0]).toMatchObject({ loggedIn: false });

    const account = await b.service.addAgentAccount('claude', 'Agencia');
    expect(fs.existsSync(path.join(b.dir, 'accounts', 'claude', account.id))).toBe(true);
    const primary = await b.service.setPrimaryAgent({ runtime: 'claude', model: null, accountId: account.id });
    expect(primary.label).toBe('Claude Code · Agencia');
    await b.service.removeAgentAccount('claude', account.id);
    expect(await b.service.getPrimaryAgent()).toBeNull();
    await expect(b.service.removeAgentAccount('claude', SYSTEM_ACCOUNT_ID)).rejects.toThrow(/cannot be removed/);
    await expect(b.service.addAgentAccount('opencode' as never, 'x')).rejects.toThrow(/Unknown runtime/);
  });

  it('routes login through an embedded terminal session with the managed profile', async () => {
    const account = await b.service.addAgentAccount('claude', 'Agencia');
    // Terminal backend is the broken loader in tests: the failure must be honest, not a fake session.
    await expect(b.service.startAccountLogin('claude', account.id)).rejects.toThrow(/Terminal backend unavailable/);
  });
});
