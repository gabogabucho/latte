import { spawn } from 'node:child_process';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../shared/contracts';
import { SYSTEM_ACCOUNT_ID } from '../../electron/agents/accounts';
import { resolveCodexBinary } from '../../electron/agents/codex/appServer';
import { CodexChatAdapter, partFromItem } from '../../electron/agents/codex/codexAdapter';
import { makeTempDir, removeDir } from './helpers';

const FAKE_CODEX = path.resolve(__dirname, 'fakeCodex.cjs');

async function waitFor(check: () => boolean, timeoutMs = 6_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function fakeAdapter(events: ChatEvent[], dir: string, spawned?: Array<{ args: string[]; env: Record<string, string | undefined> }>) {
  return new CodexChatAdapter({
    resolveExecutable: async () => ({ executable: process.execPath, version: '0.153.4' }),
    emit: (e) => events.push(e),
    accountEnv: (accountId): Record<string, string> => (accountId ? { CODEX_HOME: `C:\\managed\\${accountId}` } : {}),
    serverCwd: dir,
    platform: 'linux',
    env: { PATH: process.env.PATH ?? '', CODEX_HOME: 'inherited-from-orca', ORCA_RUN: '1' },
    spawnImpl: ((file: string, args: string[], options: { env?: Record<string, string> }) => {
      spawned?.push({ args, env: options.env ?? {} });
      return spawn(file, [FAKE_CODEX, ...args], options as Parameters<typeof spawn>[2]);
    }) as typeof spawn,
    requestTimeoutMs: 5_000,
  });
}

describe('Codex binary resolution and item translation', () => {
  it('finds the platform binary behind the npm shim', () => {
    const shim = 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd';
    const real = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe';
    const readdir = (p: string) => (p.endsWith(path.win32.join('codex', 'node_modules', '@openai')) ? ['codex-win32-x64'] : p.endsWith('vendor') ? ['x86_64-pc-windows-msvc'] : []);
    expect(resolveCodexBinary(shim, 'win32', (p) => p === real, readdir)).toBe(real);
    expect(resolveCodexBinary(shim, 'win32', () => false, () => [])).toBe(shim);
    expect(resolveCodexBinary('/usr/bin/codex', 'linux', () => true, () => [])).toBe('/usr/bin/codex');
  });

  it('translates thread items to UI parts', () => {
    expect(partFromItem({ id: 'a', type: 'agentMessage', text: 'hi' })).toEqual({ type: 'text', id: 'a', text: 'hi' });
    expect(partFromItem({ id: 'c', type: 'commandExecution', command: 'ls', status: 'completed', aggregatedOutput: 'x', exitCode: 0 })).toMatchObject({ type: 'tool', tool: 'command', status: 'completed', output: 'x' });
    expect(partFromItem({ id: 'f', type: 'fileChange', status: 'inProgress', changes: [{ path: 'brief.md', kind: 'update', diff: '+hola' }] })).toMatchObject({ type: 'tool', tool: 'edit', status: 'running', title: 'brief.md', input: '+hola' });
    expect(partFromItem({ id: 'u', type: 'userMessage', content: [] })).toBeNull();
    expect(partFromItem({ id: 'r', type: 'reasoning', summary: ['thinking'] })).toEqual({ type: 'reasoning', id: 'r', text: 'thinking' });
  });
});

describe('CodexChatAdapter against a fake app-server', () => {
  let events: ChatEvent[];
  let adapter: CodexChatAdapter;
  let dir: string;

  beforeEach(() => {
    events = [];
    dir = makeTempDir();
    adapter = fakeAdapter(events, dir);
  });

  afterEach(() => {
    adapter.shutdown();
    removeDir(dir);
  });

  it('asks Codex for its own catalog instead of hardcoding one', async () => {
    const spawned: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
    adapter = fakeAdapter(events, dir, spawned);

    const models = await adapter.listModels(SYSTEM_ACCOUNT_ID);
    // Hidden models, entries without an identifier and repeats are not
    // offered; the rest keeps the runtime's own name, description and default.
    expect(models).toEqual([
      { id: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Our most capable model.', isDefault: true },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Everyday workhorse.', isDefault: false },
    ]);
    expect(spawned).toHaveLength(1);

    // A managed account is asked with its own CODEX_HOME.
    await adapter.listModels('acc_00112233445566aa');
    expect(spawned[1].env.CODEX_HOME).toBe('C:\\managed\\acc_00112233445566aa');

    // With a conversation open, the running server answers: nothing new is spawned.
    await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Codex', accountId: SYSTEM_ACCOUNT_ID });
    const before = spawned.length;
    expect((await adapter.listModels(SYSTEM_ACCOUNT_ID)).map(m => m.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol']);
    expect(spawned).toHaveLength(before);
  });

  it('starts a thread in the work directory, streams a reply and persists the thread id', async () => {
    const spawned: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
    adapter = fakeAdapter(events, dir, spawned);
    const { session, runtimeSessionId } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Codex · mi sesión', accountId: SYSTEM_ACCOUNT_ID });
    expect(session).toMatchObject({ provider: 'codex', accountId: SYSTEM_ACCOUNT_ID, resumed: false });
    expect(runtimeSessionId).toMatch(/^thr_/);
    expect(spawned[0].args).toEqual(['app-server']);
    // System profile: the inherited orchestrator CODEX_HOME is dropped; the CLI uses its real default.
    expect(spawned[0].env.CODEX_HOME).toBeUndefined();
    expect(spawned[0].env.ORCA_RUN).toBeUndefined();

    await adapter.send(session.id, 'Hola Codex');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));
    const messages = adapter.listMessages(session.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].parts[0]).toMatchObject({ type: 'text', text: 'Echo: Hola Codex' });
    expect(messages[1].completed).toBe(true);
    expect(events.filter((e) => e.type === 'delta').length).toBe(2);
  });

  it('uses the managed profile and resumes a thread with its history', async () => {
    const spawned: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
    adapter = fakeAdapter(events, dir, spawned);
    const first = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Codex · agencia', accountId: 'acc_0123456789abcdef' });
    expect(spawned[0].env.CODEX_HOME).toBe('C:\\managed\\acc_0123456789abcdef');
    await adapter.send(first.session.id, 'Primer mensaje');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));

    // Same server instance: resume by thread id and load the history back.
    const resumed = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Codex · agencia', accountId: 'acc_0123456789abcdef', previousSessionId: first.runtimeSessionId });
    expect(resumed.session.resumed).toBe(true);
    const history = adapter.listMessages(resumed.session.id);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(history[1].parts[0]).toMatchObject({ text: 'Echo: Primer mensaje' });

    const fresh = await adapter.start({ workId: 'wrk_2', directory: dir, title: 't', label: 'x', accountId: 'acc_0123456789abcdef', previousSessionId: 'thr_missing' });
    expect(fresh.session.resumed).toBe(false);
  });

  it('turns command approvals into permission cards and honours the answer', async () => {
    const { session } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Codex', accountId: null });
    await adapter.send(session.id, 'please run it');
    await waitFor(() => events.some((e) => e.type === 'permission'));
    const permission = events.find((e) => e.type === 'permission') as Extract<ChatEvent, { type: 'permission' }>;
    expect(permission.request).toMatchObject({ permission: 'command', patterns: ['echo hola'], title: 'Needs to run a command', always: ['session'] });
    await expect(adapter.replyPermission(session.id, 'req_nope', 'once')).rejects.toThrow(/Permission request not found/);
    await adapter.replyPermission(session.id, permission.request.id, 'always');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));
    const tool = adapter.listMessages(session.id)[1].parts.find((p) => p.type === 'tool');
    expect(tool).toMatchObject({ tool: 'command', status: 'completed', output: 'hola\n' });
    expect(events.some((e) => e.type === 'permission-resolved')).toBe(true);
  });

  it('turns user-input requests into questions and answers by question id', async () => {
    const { session } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Codex', accountId: null });
    await adapter.send(session.id, 'ask me');
    await waitFor(() => events.some((e) => e.type === 'question'));
    const question = events.find((e) => e.type === 'question') as Extract<ChatEvent, { type: 'question' }>;
    expect(question.request.questions[0]).toMatchObject({ header: 'Tono', options: [{ label: 'Warm' }, { label: 'Formal' }] });
    await adapter.replyQuestion(session.id, question.request.id, [['Formal']]);
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));
    expect(adapter.listMessages(session.id)[1].parts[0]).toMatchObject({ text: 'You chose Formal.' });
  });

  it('interrupts, reports failures and starts a browser login', async () => {
    const { session } = await adapter.start({ workId: 'wrk_1', directory: dir, title: 't', label: 'Codex', accountId: null });
    await adapter.send(session.id, 'be slow');
    await expect(adapter.send(session.id, 'again')).rejects.toThrow(/still working/);
    await adapter.abort(session.id);
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));

    await adapter.send(session.id, 'please fail');
    await waitFor(() => events.some((e) => e.type === 'error'));
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: 'Simulated failure' });

    const login = await adapter.startLogin(SYSTEM_ACCOUNT_ID);
    expect(login).toMatchObject({ mode: 'browser', url: 'https://auth.example.test/codex?login=1' });

    adapter.stop(session.id);
    expect(events.at(-1)).toMatchObject({ type: 'closed', reason: 'stopped' });
  });
});
