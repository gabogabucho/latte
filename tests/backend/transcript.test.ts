import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEvent, ChatMessage } from '../../shared/contracts';
import { ClaudeChatAdapter } from '../../electron/agents/claude/claudeAdapter';
import { TranscriptStore } from '../../electron/agents/transcripts';
import { makeTempDir, removeDir } from './helpers';

const FAKE_CLAUDE = path.resolve(__dirname, 'fakeClaude.cjs');

async function waitFor(check: () => boolean, timeoutMs = 6_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function adapterWith(dir: string, events: ChatEvent[], transcripts?: TranscriptStore) {
  return new ClaudeChatAdapter({
    resolveExecutable: async () => ({ executable: process.execPath, version: '2.1.263' }),
    emit: (e) => events.push(e),
    accountEnv: () => ({}),
    transcripts,
    spawnImpl: ((file: string, args: string[], options: Parameters<typeof spawn>[2]) => spawn(file, [FAKE_CLAUDE, ...args], options)) as typeof spawn,
    platform: 'linux',
    env: { PATH: process.env.PATH ?? '' },
  });
}

describe('TranscriptStore', () => {
  let dir: string;
  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => removeDir(dir));

  it('keeps one file per chat, ignores junk lines and forgets on demand', () => {
    const store = new TranscriptStore(path.join(dir, 'transcripts'));
    const message = (id: string, chatId: string, text: string): ChatMessage => ({ id, chatId, role: 'user', parts: [{ type: 'text', id: `${id}-p`, text }], createdAt: '2026-01-01T00:00:00.000Z', completed: true, error: null });
    store.append('mem_a', message('m1', 'mem_a', 'hola'));
    store.append('mem_b', message('m1', 'mem_b', 'otra conversación'));
    expect(store.load('mem_a').map((m) => (m.parts[0] as { text: string }).text)).toEqual(['hola']);
    expect(store.load('mem_b').map((m) => (m.parts[0] as { text: string }).text)).toEqual(['otra conversación']);

    // A later line with the same id replaces the earlier one (a completed turn).
    store.append('mem_a', { ...message('m1', 'mem_a', 'hola'), parts: [{ type: 'text', id: 'm1-p', text: 'hola editado' }] });
    expect(store.load('mem_a')).toHaveLength(1);
    expect((store.load('mem_a')[0].parts[0] as { text: string }).text).toBe('hola editado');

    fs.appendFileSync(path.join(dir, 'transcripts', 'mem_a.jsonl'), 'not json\n{"id":"x"}\n');
    expect(store.load('mem_a')).toHaveLength(1);

    // Ids that are not Latte ids never become file names.
    store.append('../escape', message('m1', '../escape', 'nope'));
    expect(fs.readdirSync(path.join(dir, 'transcripts')).sort()).toEqual(['mem_a.jsonl', 'mem_b.jsonl']);
    expect(store.load('../escape')).toEqual([]);
    expect(store.load('mem_missing')).toEqual([]);

    store.forget('mem_a');
    expect(store.load('mem_a')).toEqual([]);
    expect(store.load('mem_b')).toHaveLength(1);
  });
});

describe('Claude members keep their visible history across pause and restart', () => {
  let dir: string;
  let events: ChatEvent[];
  let adapter: ClaudeChatAdapter | null = null;

  beforeEach(() => { dir = makeTempDir(); events = []; });
  afterEach(() => { adapter?.shutdown(); adapter = null; removeDir(dir); });

  it('replays earlier turns on resume, adds no duplicates and is honest about legacy sessions', async () => {
    const store = new TranscriptStore(path.join(dir, 'transcripts'));
    adapter = adapterWith(dir, events, store);
    const first = await adapter.start({ workId: 'wrk_1', chatId: 'mem_claude', directory: dir, title: 't', label: 'Claude Code · mi sesión' });
    expect(first.session.historyRecovered).toBe(false);
    await adapter.send('mem_claude', 'Primer mensaje');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));
    expect(adapter.listMessages('mem_claude').map((m) => m.role)).toEqual(['user', 'assistant']);

    // Pause: the process goes away, the record stays.
    adapter.stop('mem_claude');
    adapter.shutdown();

    // A brand new adapter, as after an app restart.
    events = [];
    adapter = adapterWith(dir, events, store);
    const resumed = await adapter.start({ workId: 'wrk_1', chatId: 'mem_claude', directory: dir, title: 't', label: 'Claude Code · mi sesión', previousSessionId: 'sess-fake-0001' });
    expect(resumed.session.resumed).toBe(true);
    expect(resumed.session.historyRecovered).toBe(true);
    const restored = adapter.listMessages('mem_claude');
    expect(restored.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect((restored[0].parts[0] as { text: string }).text).toBe('Primer mensaje');
    expect((restored[1].parts[0] as { text: string }).text).toBe('Echo: Primer mensaje');

    // Continuing the conversation appends, it does not restart or duplicate.
    await adapter.send('mem_claude', 'Segundo mensaje');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));
    const after = adapter.listMessages('mem_claude');
    expect(after.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(new Set(after.map((m) => m.id)).size).toBe(4);

    // A third open reads the file back with all four turns, exactly once each.
    adapter.stop('mem_claude');
    adapter.shutdown();
    adapter = adapterWith(dir, [], store);
    const third = await adapter.start({ workId: 'wrk_1', chatId: 'mem_claude', directory: dir, title: 't', label: 'x', previousSessionId: 'sess-fake-0001' });
    expect(adapter.listMessages('mem_claude')).toHaveLength(4);
    expect(third.session.historyRecovered).toBe(true);

    // A member from before this feature: resumed in the runtime, no local record, and it says so.
    const legacy = await adapter.start({ workId: 'wrk_1', chatId: 'mem_legacy', directory: dir, title: 't', label: 'x', previousSessionId: 'sess-old' });
    expect(legacy.session.resumed).toBe(true);
    expect(legacy.session.historyRecovered).toBe(false);
    expect(adapter.listMessages('mem_legacy')).toEqual([]);
  });

  it('works without a transcript store (nothing recorded, nothing broken)', async () => {
    adapter = adapterWith(dir, events);
    await adapter.start({ workId: 'wrk_1', chatId: 'mem_plain', directory: dir, title: 't', label: 'x' });
    await adapter.send('mem_plain', 'Hola');
    await waitFor(() => events.some((e) => e.type === 'status' && e.status === 'idle'));
    expect(adapter.listMessages('mem_plain')).toHaveLength(2);
    expect(fs.existsSync(path.join(dir, 'transcripts'))).toBe(false);
  });
});
