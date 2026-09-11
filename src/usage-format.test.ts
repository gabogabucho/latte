import { describe, expect, it, vi } from 'vitest';
// usage-format imports formatMessage from './i18n', which in turn imports the
// real './browser-api' for its locale getters; that module reaches for
// `window` at module scope, which does not exist under the node test
// environment. Same workaround as optional-mcp-view.test.ts and
// work-outcome-view.test.ts.
vi.mock('./browser-api', () => ({ api: {} }));
const { EMPTY_USAGE } = await import('../shared/contracts');
type ChatUsage = import('../shared/contracts').ChatUsage;
const { cacheShare, contextWeight, describeUsage, formatTokens, totalTokens } = await import('./usage-format');

const usage = (patch: Partial<ChatUsage>): ChatUsage => ({ ...EMPTY_USAGE, ...patch });

describe('formatTokens', () => {
  it('shows small counts as plain numbers in both locales', () => {
    expect(formatTokens(0, 'es-AR')).toBe('0');
    expect(formatTokens(850, 'es-AR')).toBe('850');
    expect(formatTokens(850, 'en-US')).toBe('850');
  });

  it('abbreviates thousands the way a marketer would say them out loud', () => {
    expect(formatTokens(12_000, 'es-AR')).toBe('12 mil');
    expect(formatTokens(12_000, 'en-US')).toBe('12K');
  });

  it('abbreviates millions with one decimal, locale-aware', () => {
    expect(formatTokens(1_200_000, 'es-AR')).toBe('1,2 M');
    expect(formatTokens(1_200_000, 'en-US')).toBe('1.2M');
  });

  it('drops a decimal that would just be zero', () => {
    expect(formatTokens(12_000, 'es-AR')).not.toContain(',0');
    expect(formatTokens(2_000_000, 'en-US')).toBe('2M');
  });
});

describe('totalTokens', () => {
  it('sums every flavor of token the runtime reported', () => {
    expect(totalTokens(usage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 }))).toBe(20);
    expect(totalTokens(EMPTY_USAGE)).toBe(0);
  });
});

describe('cacheShare', () => {
  it('is the fraction of input tokens served from the prompt cache', () => {
    expect(cacheShare(usage({ inputTokens: 100, cacheReadTokens: 850, cacheWriteTokens: 50 }))).toBeCloseTo(0.85);
  });

  it('is zero when there is no input to share, never a division error', () => {
    expect(cacheShare(EMPTY_USAGE)).toBe(0);
  });

  it('ignores output tokens: only input flavors count', () => {
    expect(cacheShare(usage({ inputTokens: 0, cacheReadTokens: 10, cacheWriteTokens: 0, outputTokens: 1000 }))).toBe(1);
  });
});

describe('contextWeight', () => {
  it('is light below 30K and treats an unknown context as light', () => {
    expect(contextWeight(null)).toBe('light');
    expect(contextWeight(0)).toBe('light');
    expect(contextWeight(29_999)).toBe('light');
  });

  it('is medium from 30K up to (not including) 100K', () => {
    expect(contextWeight(30_000)).toBe('medium');
    expect(contextWeight(99_999)).toBe('medium');
  });

  it('is heavy at 100K and above', () => {
    expect(contextWeight(100_000)).toBe('heavy');
    expect(contextWeight(500_000)).toBe('heavy');
  });
});

describe('describeUsage', () => {
  it('says nothing before the first turn', () => {
    expect(describeUsage(EMPTY_USAGE, 'es-AR')).toBe('');
    expect(describeUsage(usage({ turns: 0, inputTokens: 500 }), 'en-US')).toBe('');
  });

  it('never mentions "tokens" in the primary line', () => {
    const line = describeUsage(usage({ turns: 1, inputTokens: 15_000, cacheReadTokens: 85_000, outputTokens: 20_000 }), 'es-AR');
    expect(line.toLowerCase()).not.toContain('token');
  });

  it('reports the total and the cache share in plain language, per locale', () => {
    const data = usage({ turns: 4, inputTokens: 15_000, cacheReadTokens: 85_000, cacheWriteTokens: 0, outputTokens: 20_000 });
    // total = 15k + 85k + 20k = 120k; cache share = 85k / (15k + 85k) = 85%.
    expect(describeUsage(data, 'es-AR')).toBe('120 mil · 85% vino de la memoria de la conversación');
    expect(describeUsage(data, 'en-US')).toBe("120K · 85% came from the conversation's memory");
  });
});
