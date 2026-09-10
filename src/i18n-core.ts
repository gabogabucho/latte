import type { UiLocale } from '../shared/contracts';

export const es = {
  'common.roles': '{count, plural, one {# rol} other {# roles}}',
} as const;
export type CoreMessageKey = keyof typeof es;
export function interpolate(locale: UiLocale, template: string, params: Record<string, string | number> = {}): string {
  const plural = template.match(/^\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}$/);
  if (plural) { const n = Number(params[plural[1]] ?? 0); return (new Intl.PluralRules(locale).select(n) === 'one' ? plural[2] : plural[3]).replace('#', String(n)); }
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
