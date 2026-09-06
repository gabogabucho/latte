import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatManager, translateAuthMethods } from '../../electron/opencode/chatManager';
import { fakeRunner, makeBackend, type TestBackend } from './helpers';
import { startFakeOpenCode, type FakeOpenCode } from './fakeOpenCode';

describe('provider auth translation', () => {
  it('keeps method indexes stable and normalises prompts', () => {
    const methods = translateAuthMethods([
      { type: 'oauth', label: 'Browser' },
      { type: 'api', label: 'Key', prompts: [{ type: 'text', key: 'key', message: 'API key', placeholder: 'sk-…' }, { type: 'select', key: 'region', message: 'Region', options: [{ label: 'EU', value: 'eu' }] }] },
    ]);
    expect(methods).toEqual([
      { index: 0, type: 'oauth', label: 'Browser', prompts: [] },
      { index: 1, type: 'api', label: 'Key', prompts: [
        { key: 'key', type: 'text', message: 'API key', placeholder: 'sk-…', options: [] },
        { key: 'region', type: 'select', message: 'Region', placeholder: '', options: [{ label: 'EU', value: 'eu', hint: '' }] },
      ] },
    ]);
    expect(translateAuthMethods(undefined)).toEqual([]);
  });
});

describe('providers through the runtime', () => {
  let fake: FakeOpenCode;
  let manager: ChatManager;

  beforeEach(async () => {
    fake = await startFakeOpenCode();
    manager = new ChatManager({
      resolveExecutable: async () => ({ executable: 'C:\\fake\\opencode.exe', version: '1.18.26' }),
      serverCwd: 'C:\\latte-data',
      emit: () => {},
      endpoint: fake.endpoint,
      clientTimeoutMs: 3_000,
    });
  });

  afterEach(async () => {
    manager.shutdown();
    await fake.close();
  });

  it('lists the catalog with connection state, models and login methods, connected first', async () => {
    const providers = await manager.listProviders();
    expect(providers.map((p) => p.id)).toEqual(['fake-provider', 'deepseek', 'openai']);
    expect(providers[0]).toMatchObject({ connected: true, models: ['fake-model'], methods: [] });
    expect(providers[1]).toMatchObject({ id: 'deepseek', name: 'DeepSeek', connected: false, models: ['deepseek-chat', 'deepseek-reasoner'] });
    expect(providers[2].methods.map((m) => `${m.index}:${m.type}`)).toEqual(['0:oauth', '1:oauth', '2:api']);
  });

  it('stores an API key in the runtime store and can disconnect it again', async () => {
    await manager.connectApiKey('deepseek', 'sk-test-123');
    expect(fake.credentials.get('deepseek')).toEqual({ type: 'api', key: 'sk-test-123' });
    const put = fake.requests.find((r) => r.method === 'PUT' && r.path === '/auth/deepseek');
    expect(put?.query.get('directory')).toBe('C:\\latte-data');
    expect((await manager.listProviders()).find((p) => p.id === 'deepseek')?.connected).toBe(true);

    await manager.disconnectProvider('deepseek');
    expect(fake.credentials.has('deepseek')).toBe(false);
    expect((await manager.listProviders()).find((p) => p.id === 'deepseek')?.connected).toBe(false);
  });

  it('runs an OAuth login with a pasted code and surfaces runtime rejections', async () => {
    const started = await manager.startOAuth('openai', 1, {});
    expect(started).toEqual({ url: 'https://login.example.test/openai?m=1', method: 'code', instructions: 'Paste the code shown by the browser.' });
    await expect(manager.completeOAuth('openai', 1, 'wrong')).rejects.toThrow(/Could not complete the login for openai.*400/);
    await manager.completeOAuth('openai', 1, 'good-code');
    expect(fake.credentials.get('openai')).toEqual({ type: 'oauth' });

    const auto = await manager.startOAuth('openai', 0, {});
    expect(auto.method).toBe('auto');
    await manager.completeOAuth('openai', 0, null);
    const callback = fake.requests.filter((r) => r.path === '/provider/openai/oauth/callback').at(-1);
    expect(callback?.body).toEqual({ method: 0 });
  });
});

describe('LatteService provider validation and browser hand-off', () => {
  let fake: FakeOpenCode;
  let b: TestBackend;
  let opened: string[];

  beforeEach(async () => {
    fake = await startFakeOpenCode();
    opened = [];
    b = await makeBackend({
      chatEndpoint: fake.endpoint,
      runner: fakeRunner((file, args) => (file === 'where.exe' || file === 'which') && args[0] === 'opencode' ? { code: 0, stdout: 'C:\\npm\\opencode.exe\n' } : { code: 0, stdout: '1.18.26\n' }),
      emitChat: () => {},
      openExternal: async (url) => { opened.push(url); },
    });
  });

  afterEach(async () => {
    b.cleanup();
    await fake.close();
  });

  it('validates ids, keys and codes before anything reaches the runtime', async () => {
    await expect(b.service.connectProviderKey('Deep Seek', 'sk')).rejects.toThrow(/Invalid provider id/);
    await expect(b.service.connectProviderKey('deepseek', '   ')).rejects.toThrow(/API key looks invalid/);
    await expect(b.service.connectProviderKey('deepseek', 'sk\nnewline')).rejects.toThrow(/API key looks invalid/);
    await expect(b.service.startProviderOAuth('openai', 99, {})).rejects.toThrow(/methodIndex/);
    await expect(b.service.startProviderOAuth('openai', 0, { 'bad key!': 'x' })).rejects.toThrow(/Invalid inputs/);
    await expect(b.service.completeProviderOAuth('openai', 1, '')).rejects.toThrow(/Invalid code/);
    expect(fake.requests.some((r) => r.path.startsWith('/auth/') || r.path.includes('/oauth/'))).toBe(false);
  });

  it('trims the key, opens the OAuth URL in the system browser and reports the new state', async () => {
    await b.service.connectProviderKey('deepseek', '  sk-live-abc  ');
    expect(fake.credentials.get('deepseek')).toEqual({ type: 'api', key: 'sk-live-abc' });

    const started = await b.service.startProviderOAuth('openai', 1, {});
    expect(opened).toEqual(['https://login.example.test/openai?m=1']);
    expect(started.method).toBe('code');
    await b.service.completeProviderOAuth('openai', 1, ' good-code ');
    const providers = await b.service.listProviders();
    expect(providers.filter((p) => p.connected).map((p) => p.id).sort()).toEqual(['deepseek', 'fake-provider', 'openai']);
  });
});
