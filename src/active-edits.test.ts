import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatPart, ChatToolStatus } from '../shared/contracts';
import { editsInProgress } from './active-edits';

const message = (parts: ChatPart[]): ChatMessage => ({ id: 'm1', chatId: 'mem_1', role: 'assistant', parts, createdAt: '2026-01-01T00:00:00.000Z', completed: false, error: null });
const tool = (name: string, title: string, status: ChatToolStatus = 'running', input = ''): ChatPart => ({ type: 'tool', id: `t-${name}-${title}`, tool: name, status, title, input, output: '', error: '' });

const FILES = ['brief.md', 'estrategia.md', 'calendar.md'];

describe('Who is writing to a document, right now', () => {
  it('credits an edit only when a runtime reported the tool call', () => {
    // Claude puts file_path in the title.
    expect(editsInProgress([message([tool('Write', 'C:\\trabajo\\estrategia.md')])], FILES)).toEqual(['estrategia.md']);
    // Codex joins the changed paths under the `edit` tool.
    expect(editsInProgress([message([tool('edit', 'calendar.md, otro.md')])], FILES)).toEqual(['calendar.md']);
    // OpenCode passes the provider's own title, and the path may be in the input.
    expect(editsInProgress([message([tool('edit', 'Editing file', 'running', '{"filePath":"brief.md"}')])], FILES)).toEqual(['brief.md']);
  });

  it('says nothing once the tool finished', () => {
    expect(editsInProgress([message([tool('Write', 'estrategia.md', 'completed')])], FILES)).toEqual([]);
    expect(editsInProgress([message([tool('Write', 'estrategia.md', 'error')])], FILES)).toEqual([]);
    expect(editsInProgress([message([tool('Write', 'estrategia.md', 'pending')])], FILES)).toEqual([]);
  });

  it('does not treat reading or running a command as writing', () => {
    // A shell command that merely mentions the file is not an edit: attributing
    // it would be a guess, and a guess is exactly what must not happen here.
    expect(editsInProgress([message([tool('command', 'cat estrategia.md')])], FILES)).toEqual([]);
    expect(editsInProgress([message([tool('Read', 'estrategia.md')])], FILES)).toEqual([]);
    expect(editsInProgress([message([tool('Grep', 'brief.md')])], FILES)).toEqual([]);
  });

  it('only reports files this work actually tracks', () => {
    expect(editsInProgress([message([tool('Write', 'otra-cosa.md')])], FILES)).toEqual([]);
    expect(editsInProgress([message([tool('Write', 'estrategia.md')])], [])).toEqual([]);
  });

  it('reports several files at once and never duplicates one', () => {
    const parts = [tool('Write', 'brief.md'), tool('Edit', 'estrategia.md'), tool('MultiEdit', 'brief.md')];
    expect(editsInProgress([message(parts)], FILES).sort()).toEqual(['brief.md', 'estrategia.md']);
  });

  it('ignores text and reasoning parts', () => {
    const parts: ChatPart[] = [
      { type: 'text', id: 'x', text: 'voy a editar estrategia.md' },
      { type: 'reasoning', id: 'y', text: 'debería tocar brief.md' },
    ];
    expect(editsInProgress([message(parts)], FILES)).toEqual([]);
  });
});
