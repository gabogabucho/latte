import { EMPTY_USAGE, type ChatUsage } from '../../shared/contracts';

/**
 * Arithmetic over what the runtimes report. It lives here, away from both the
 * adapters and the repository, because the same two operations are needed in
 * three places: an adapter adds up the process it runs, the repository adds up
 * the member's whole life, and a test compares the two.
 *
 * Nothing here estimates anything. A number that never arrived stays null; a
 * number that arrived as zero stays zero, because "the runtime said zero" and
 * "the runtime said nothing" are different claims.
 */
export function addUsage(total: ChatUsage, turn: ChatUsage): ChatUsage {
  return {
    inputTokens: total.inputTokens + turn.inputTokens,
    outputTokens: total.outputTokens + turn.outputTokens,
    cacheReadTokens: total.cacheReadTokens + turn.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + turn.cacheWriteTokens,
    turns: total.turns + turn.turns,
    // Cost only accumulates over the turns that came with one. A runtime that
    // never prices a turn (a subscription CLI) leaves this null forever.
    costUsd: turn.costUsd === null ? total.costUsd : (total.costUsd ?? 0) + turn.costUsd,
    // Not a sum: this is the size of the context after the last turn, so the
    // newest reading wins and an older one is never added to it.
    contextTokens: turn.contextTokens ?? total.contextTokens,
  };
}

/** A finite, non-negative count, or 0. Anything else the wire carries is not a token count. */
export function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Usage as it was persisted. A row written before this column existed, or one
 * a human edited into nonsense, reads as "nothing measured yet" rather than as
 * an error: the conversation matters more than its meter.
 */
export function parseUsage(raw: string | null | undefined): ChatUsage {
  if (typeof raw !== 'string' || raw.length === 0) return EMPTY_USAGE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return EMPTY_USAGE;
    const record = parsed as Record<string, unknown>;
    return {
      inputTokens: tokenCount(record.inputTokens),
      outputTokens: tokenCount(record.outputTokens),
      cacheReadTokens: tokenCount(record.cacheReadTokens),
      cacheWriteTokens: tokenCount(record.cacheWriteTokens),
      turns: tokenCount(record.turns),
      costUsd: typeof record.costUsd === 'number' && Number.isFinite(record.costUsd) ? record.costUsd : null,
      contextTokens: typeof record.contextTokens === 'number' && Number.isFinite(record.contextTokens) ? Math.round(record.contextTokens) : null,
    };
  } catch {
    return EMPTY_USAGE;
  }
}

export function serializeUsage(usage: ChatUsage): string {
  return JSON.stringify(usage);
}
