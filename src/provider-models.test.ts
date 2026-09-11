import { describe, expect, it } from 'vitest';
import { continuationModel, continuationOptions, selectedAccountModel, selectedProviderModel, validModelInput } from './provider-models';

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

describe('continuation model', () => {
  const source = { runtime: 'codex' as const, model: 'gpt-5.1-codex-max' };
  const otherCodex = { key: 'codex:acc_0123456789abcdef', runtime: 'codex' as const, accountId: 'acc_0123456789abcdef' };
  it('keeps a non-default source model on another account of the same runtime, and sends it explicitly', () => {
    const model = continuationModel(otherCodex, source, 'primary-model', {});
    expect(model).toBe('gpt-5.1-codex-max');
    expect(continuationOptions(otherCodex, model)).toEqual({ runtime: 'codex', accountId: 'acc_0123456789abcdef', model: 'gpt-5.1-codex-max' });
  });
  it('prefers the source model over the primary one when the primary runs the same runtime', () => {
    expect(continuationModel({ key: 'primary', runtime: 'codex', accountId: 'system' }, source, 'primary-model', {})).toBe('gpt-5.1-codex-max');
    // A source on the runtime default stays on the default rather than inheriting the primary's model.
    expect(continuationModel({ key: 'primary', runtime: 'codex', accountId: 'system' }, { runtime: 'codex', model: null }, 'primary-model', {})).toBe('');
  });
  it('never carries a model ID across runtimes; the primary keeps its saved model there', () => {
    expect(continuationModel({ key: 'claude:system', runtime: 'claude', accountId: 'system' }, source, null, {})).toBe('');
    expect(continuationModel({ key: 'primary', runtime: 'opencode', accountId: null }, source, 'provider/model', {})).toBe('provider/model');
    expect(continuationOptions({ key: 'opencode', runtime: 'opencode', accountId: 'ignored' }, 'provider/model')).toEqual({ runtime: 'opencode', accountId: null, model: 'provider/model' });
  });
  it('lets the person pick another model per agent, or reset to the default explicitly', () => {
    expect(continuationModel(otherCodex, source, null, { [otherCodex.key]: 'gpt-5-mini' })).toBe('gpt-5-mini');
    expect(continuationModel(otherCodex, source, null, { [otherCodex.key]: '' })).toBe('');
    expect(continuationModel(otherCodex, source, null, { 'codex:system': 'gpt-5-mini' })).toBe('gpt-5.1-codex-max');
    expect(continuationOptions({ key: 'primary', runtime: 'claude', accountId: null }, '')).toEqual({ runtime: 'claude', accountId: 'system', model: null });
  });
});
