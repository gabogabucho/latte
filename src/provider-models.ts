import type { AgentAccount, ChatRuntime, PrimaryAgent, ProviderInfo, TeamMember, TeamMemberOptions } from '../shared/contracts';

export function accountModelKey(account: Pick<AgentAccount, 'runtime' | 'id'>): string {
  return `${account.runtime}:${account.id}`;
}

export function selectedAccountModel(account: Pick<AgentAccount, 'runtime' | 'id'>, primary: PrimaryAgent | null, drafts: Record<string, string>): string {
  return drafts[accountModelKey(account)] ?? (primary?.runtime === account.runtime && (primary.accountId ?? 'system') === account.id ? primary.model ?? '' : '');
}

export function selectedProviderModel(provider: Pick<ProviderInfo, 'id' | 'models'>, primary: PrimaryAgent | null, drafts: Record<string, string>): string {
  const prefix = `${provider.id}/`;
  const saved = primary?.runtime === 'opencode' && primary.model?.startsWith(prefix) ? primary.model.slice(prefix.length) : null;
  return drafts[provider.id] ?? saved ?? provider.models[0] ?? '';
}

/** An agent a continuation can go to: `primary` or a `runtime:account` choice. */
export interface ContinuationTarget { key: string; runtime: ChatRuntime; accountId: string | null }

/**
 * The model a continuation starts on. On the source's runtime it is the
 * source's model, the runtime default included: a successor must not change
 * engines silently. Another runtime cannot take that ID, so the primary agent
 * keeps its own saved model and anything else starts on its default. What the
 * person picked for that agent in the dialog always wins, even an explicit
 * reset to the default ('').
 */
export function continuationModel(target: ContinuationTarget, source: Pick<TeamMember, 'runtime' | 'model'>, primaryModel: string | null, drafts: Record<string, string>): string {
  return drafts[target.key] ?? (target.runtime === source.runtime ? source.model ?? '' : target.key === 'primary' ? primaryModel ?? '' : '');
}

/** Always explicit: an empty model with an explicit runtime would otherwise mean "the runtime default". */
export function continuationOptions(target: ContinuationTarget, model: string): TeamMemberOptions {
  return { runtime: target.runtime, accountId: target.runtime === 'opencode' ? null : target.accountId ?? 'system', model: model.trim() || null };
}

/** Match the service's model-ID guard; an empty field delegates to the runtime. */
export function validModelInput(value: string): boolean {
  const model = value.trim();
  return model.length <= 200 && !/[\s\0]/.test(model);
}
