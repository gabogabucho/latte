import { describe, expect, it } from 'vitest';
import { selectedAccountModel, selectedProviderModel, validModelInput } from './provider-models';

describe('provider model selection', () => {
  it('restores the primary subscription model and supports the legacy system account', () => {
    expect(selectedAccountModel({ runtime: 'codex', id: 'system' }, { runtime: 'codex', accountId: null, model: 'custom-model', label: '' }, {})).toBe('custom-model');
  });
  it('isolates drafts by runtime and account and permits an explicit default reset', () => {
    const primary = { runtime: 'claude' as const, accountId: 'system', model: 'saved-model', label: '' };
    expect(selectedAccountModel({ runtime: 'claude', id: 'system' }, primary, { 'claude:system': '' })).toBe('');
    expect(selectedAccountModel({ runtime: 'codex', id: 'system' }, primary, { 'claude:system': 'draft-model' })).toBe('');
    expect(selectedAccountModel({ runtime: 'claude', id: 'other' }, primary, {})).toBe('');
  });
  it('restores OpenCode models including namespaced IDs instead of selecting the first catalog entry', () => {
    const provider = { id: 'provider', models: ['first', 'namespace/saved'] };
    const primary = { runtime: 'opencode' as const, accountId: null, model: 'provider/namespace/saved', label: '' };
    expect(selectedProviderModel(provider, primary, {})).toBe('namespace/saved');
    expect(selectedProviderModel(provider, primary, { provider: 'first' })).toBe('first');
    expect(selectedProviderModel(provider, null, {})).toBe('first');
  });
  it('preserves a saved model absent from the latest catalog', () => {
    expect(selectedProviderModel({ id: 'provider', models: [] }, { runtime: 'opencode', accountId: null, model: 'provider/retired', label: '' }, {})).toBe('retired');
  });
  it('accepts default and explicit IDs but rejects whitespace, null bytes and excessive length', () => {
    for (const value of ['', '  ', ' model-id ', 'namespace/model']) expect(validModelInput(value)).toBe(true);
    for (const value of ['two models', 'bad\0id', 'x'.repeat(201)]) expect(validModelInput(value)).toBe(false);
  });
});
