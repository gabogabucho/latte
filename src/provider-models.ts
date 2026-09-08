import type { AgentAccount, PrimaryAgent, ProviderInfo } from '../shared/contracts';

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

/** Match the service's model-ID guard; an empty field delegates to the runtime. */
export function validModelInput(value: string): boolean {
  const model = value.trim();
  return model.length <= 200 && !/[\s\0]/.test(model);
}
