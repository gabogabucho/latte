import fs from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Runs the actual App handler with state/API doubles, like handoff-navigation:
// it guards what "continuar con otro agente" does to each conversation.
const source = fs.readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer = '';
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'continueMember') initializer = node.initializer!.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);

type Handler = (sourceId: string, roleId: string, options: unknown, text: string) => Promise<void>;

function setup(overrides: { addTeamMember?: () => Promise<unknown>; sendChat?: () => Promise<void> } = {}) {
  const state = { layout: 'review', view: 'funnel' };
  const api = {
    addTeamMember: vi.fn(overrides.addTeamMember ?? (async () => ({ id: 'mem_new', roleName: 'Reviewer' }))),
    sendChat: vi.fn(overrides.sendChat ?? (async () => undefined)),
    // Everything that could touch a conversation other than the new one.
    pauseTeamMember: vi.fn(), finishTeamMember: vi.fn(), restartTeamMember: vi.fn(), removeTeamMember: vi.fn(), setTeamMemberModel: vi.fn(), stopChat: vi.fn(), abortChat: vi.fn(),
  };
  const chatStore = { setDraft: vi.fn(), forget: vi.fn() };
  const deps = {
    work: { id: 'wrk' }, startingChat: false, team: [{ id: 'mem_src', roleName: 'Strategist' }],
    openSession: vi.fn((open: () => Promise<unknown>) => open()),
    api, chatStore,
    setLayout: (value: string) => { state.layout = value; },
    setView: (value: string) => { state.view = value; },
    setNotice: vi.fn(), setError: vi.fn(),
    t: (key: string) => key, displayError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  };
  expect(initializer).not.toBe('');
  const code = ts.transpileModule(`const handler = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const handler = new Function(...Object.keys(deps), `${code}; return handler;`)(...Object.values(deps)) as Handler;
  const untouched = () => {
    for (const fn of [api.pauseTeamMember, api.finishTeamMember, api.restartTeamMember, api.removeTeamMember, api.setTeamMemberModel, api.stopChat, api.abortChat, chatStore.forget]) expect(fn).not.toHaveBeenCalled();
  };
  return { handler, api, chatStore, deps, state, untouched };
}

describe('continuar con otro agente', () => {
  it('opens a new member on the chosen account and sends it the reviewed hand-over', async () => {
    const { handler, api, chatStore, deps, state, untouched } = setup();
    await handler('mem_src', 'reviewer', { runtime: 'codex', accountId: 'acc_0123456789abcdef', model: null }, '# Traspaso editado');
    expect(api.addTeamMember).toHaveBeenCalledWith('wrk', 'reviewer', { runtime: 'codex', accountId: 'acc_0123456789abcdef', model: null, continuedFrom: 'mem_src' });
    expect(api.sendChat).toHaveBeenCalledTimes(1);
    expect(api.sendChat).toHaveBeenCalledWith('mem_new', '# Traspaso editado');
    expect(chatStore.setDraft).not.toHaveBeenCalled();
    expect(deps.setError).not.toHaveBeenCalled();
    expect(state).toEqual({ layout: 'conversation', view: 'brief' });
    untouched();
  });

  it('carries a non-default model to the new member instead of the runtime default', async () => {
    const { handler, api } = setup();
    await handler('mem_src', 'strategist', { runtime: 'claude', accountId: 'acc_0123456789abcdef', model: 'opus' }, 'texto');
    expect(api.addTeamMember).toHaveBeenCalledWith('wrk', 'strategist', { runtime: 'claude', accountId: 'acc_0123456789abcdef', model: 'opus', continuedFrom: 'mem_src' });
  });

  it('keeps the origin reference when the primary agent takes over', async () => {
    const { handler, api } = setup();
    await handler('mem_src', 'strategist', null, 'texto');
    expect(api.addTeamMember).toHaveBeenCalledWith('wrk', 'strategist', { continuedFrom: 'mem_src' });
  });

  it('leaves the hand-over in the new composer when only the send fails', async () => {
    const { handler, chatStore, deps, untouched } = setup({ sendChat: async () => { throw new Error('usage limit'); } });
    await handler('mem_src', 'reviewer', null, '# Traspaso');
    expect(chatStore.setDraft).toHaveBeenCalledWith('mem_new', '# Traspaso');
    expect(deps.setError).toHaveBeenCalledTimes(1);
    untouched();
  });

  it('rejects when nothing was created, so the dialog keeps the edited text', async () => {
    const { handler, api, chatStore, untouched } = setup({ addTeamMember: async () => { throw new Error('Codex no está instalado'); } });
    await expect(handler('mem_src', 'reviewer', null, '# Traspaso')).rejects.toThrow('Codex no está instalado');
    expect(api.sendChat).not.toHaveBeenCalled();
    expect(chatStore.setDraft).not.toHaveBeenCalled();
    untouched();
  });
});
