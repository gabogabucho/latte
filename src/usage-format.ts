import type { ChatUsage, UiLocale } from '../shared/contracts';
import { formatMessage } from './i18n';

/**
 * Renderer-only display math for what a conversation has consumed. Every
 * number comes straight from `ChatUsage`, itself sourced from the runtime and
 * never estimated (see shared/contracts.ts) — this module only decides how to
 * say it in a way a non-technical marketer reads at a glance, in their own
 * language. It never says "tokens" in anything meant as a primary line; that
 * word is explained once, in help text, by the caller.
 */

/** Every token this usage represents, regardless of flavor (fresh, cached read/write, or generated). */
export function totalTokens(usage: ChatUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/**
 * A big count in plain words instead of a raw integer: below a thousand, the
 * number itself; below a million, "12 mil" / "12K"; above it, "1,2 M" / "1.2M".
 * The decimal mark and thousands grouping follow the locale via `Intl`; only
 * the "mil"/"K"/"M" suffix is chosen by hand, since that is not something
 * `Intl.NumberFormat`'s compact notation phrases the way a marketer expects.
 */
export function formatTokens(n: number, locale: UiLocale): string {
  const abs = Math.abs(n);
  if (abs < 1_000) return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
  const million = abs >= 1_000_000;
  const value = n / (million ? 1_000_000 : 1_000);
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const suffix = locale === 'es-AR' ? (million ? ' M' : ' mil') : (million ? 'M' : 'K');
  return formatted + suffix;
}

/**
 * Share (0..1) of this conversation's input that was served from the prompt
 * cache instead of processed fresh. Cache reads are what keeps a long
 * conversation affordable, so this is the number that explains why one turn
 * was cheap and another was not. Zero when there is no input yet to share.
 */
export function cacheShare(usage: ChatUsage): number {
  const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return input > 0 ? usage.cacheReadTokens / input : 0;
}

export type ContextWeight = 'light' | 'medium' | 'heavy';

/** How much a conversation's own memory now costs to re-read on every new message. */
export function contextWeight(contextTokens: number | null): ContextWeight {
  const n = contextTokens ?? 0;
  if (n < 30_000) return 'light';
  if (n < 100_000) return 'medium';
  return 'heavy';
}

/**
 * The one line a marketer sees about what a conversation has spent so far.
 * Empty before the first turn: there is nothing honest to report yet, and an
 * empty string is the caller's cue to render nothing at all.
 */
export function describeUsage(usage: ChatUsage, locale: UiLocale): string {
  if (usage.turns <= 0) return '';
  const tokens = formatTokens(totalTokens(usage), locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(cacheShare(usage));
  return formatMessage(locale, 'usage.line', { tokens, percent });
}
