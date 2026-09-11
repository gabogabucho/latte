import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE, type ChatEvent, type ChatMessage, type LatteAPI } from '../shared/contracts';
import { createChatStore } from './chat-store';

/** A minimal double for the two calls the store makes on the real API. */
function fakeApi() {
  let handler: (event: ChatEvent) => void = () => undefined;
  const api: Pick<LatteAPI, 'onChatEvent' | 'listChatMessages'> = {
    onChatEvent: (cb) => { handler = cb; return () => undefined; },
    listChatMessages: async () => [] as ChatMessage[],
  };
  return { api, emit: (e: ChatEvent) => handler(e) };
}

describe('chat store usage tracking', () => {
  it('keeps the turn and the lifetime total a usage event reports', () => {
    const { api, emit } = fakeApi();
    const store = createChatStore(api);
    const turn = { ...EMPTY_USAGE, inputTokens: 10, outputTokens: 5, turns: 1 };
    const total = { ...EMPTY_USAGE, inputTokens: 110, outputTokens: 55, turns: 3 };
    emit({ chatId: 'mem_1', type: 'usage', turn, total });
    expect(store.get('mem_1').usage).toEqual(total);
    expect(store.get('mem_1').lastTurn).toEqual(turn);
  });

  it('backfills a chat with the roster total without waiting for a live turn', () => {
    const { api } = fakeApi();
    const store = createChatStore(api);
    const total = { ...EMPTY_USAGE, inputTokens: 200, turns: 4 };
    store.seedUsage('mem_2', total);
    expect(store.get('mem_2').usage).toEqual(total);
    // Untouched fields stay at their defaults: seeding usage is not a message reset.
    expect(store.get('mem_2').messages).toEqual([]);
  });

  it('a forgotten chat drops its usage until it is re-seeded', () => {
    const { api, emit } = fakeApi();
    const store = createChatStore(api);
    const total = { ...EMPTY_USAGE, inputTokens: 50, turns: 1 };
    emit({ chatId: 'mem_3', type: 'usage', turn: total, total });
    store.forget('mem_3');
    expect(store.get('mem_3').usage).toEqual(EMPTY_USAGE);
  });
});
