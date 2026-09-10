import fs from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

// Run the actual handler with state/API doubles; no DOM or Electron is needed.
// This guards the navigation transition, not the visual layout.
const source = fs.readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer = '';
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'acceptHandoff') {
    initializer = node.initializer!.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);

it('reveals the requested chat from review without sending or saving the document', async () => {
  const state = { layout: 'review', view: 'funnel', agentMode: 'chat', dirty: true };
  const setDraft = vi.fn();
  const send = vi.fn();
  const saveDocument = vi.fn();
  const deps = {
    run: (fn: () => Promise<void>) => fn(), work: { id: 'work' }, startingChat: false,
    team: [], openSession: async () => ({ id: 'paid' }),
    api: { dismissHandoff: vi.fn().mockResolvedValue(undefined), listHandoffs: vi.fn().mockResolvedValue([]), saveDocument },
    chatStore: { setDraft, send },
    setLayout: (value: string) => { state.layout = value; },
    setView: (value: string) => { state.view = value; },
    setAgentMode: (value: string) => { state.agentMode = value; },
    setHandoffs: vi.fn(), setNotice: vi.fn(), t: (key: string) => key,
  };
  expect(initializer).not.toBe('');
  const code = ts.transpileModule(`const handler = ${initializer};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const handler = new Function(...Object.keys(deps), `${code}; return handler;`)(...Object.values(deps));
  await handler({ roleId: 'paid-media', roleName: 'Paid Media', fileName: 'pedido.md', request: 'Analizá la campaña' });
  expect(state).toEqual({ layout: 'conversation', view: 'brief', agentMode: 'chat', dirty: true });
  expect(setDraft).toHaveBeenCalledWith('paid', 'Analizá la campaña');
  expect(send).not.toHaveBeenCalled();
  expect(saveDocument).not.toHaveBeenCalled();
});
