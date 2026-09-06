import { describe, expect, it } from 'vitest';
import { isNearConversationEnd } from './conversation-scroll';

describe('conversation follow mode', () => {
  it('follows short conversations and the last 64 pixels', () => {
    expect(isNearConversationEnd(0, 500, 200)).toBe(true);
    expect(isNearConversationEnd(436, 500, 1000)).toBe(true);
    expect(isNearConversationEnd(500, 500, 1000)).toBe(true);
  });
  it('does not pull a reader away from older messages', () => {
    expect(isNearConversationEnd(435, 500, 1000)).toBe(false);
    expect(isNearConversationEnd(0, 500, 1000)).toBe(false);
  });
});
