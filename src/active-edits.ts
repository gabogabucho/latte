import type { ChatMessage, ChatPart } from '../shared/contracts';

/**
 * Which file a member is editing right now, taken from what the runtime itself
 * reports about its tool calls. This is attribution, not a guess: a write that
 * did not come through a runtime's tool is never credited to anybody (see the
 * `external` revision source in the backend).
 *
 * Every runtime names the file differently, so the file name is matched
 * against the documents the work actually has instead of being parsed:
 * Claude puts `file_path` in the title, Codex joins the changed paths, and
 * OpenCode passes whatever the provider's tool reported.
 */
const EDIT_TOOL = /^(write|edit|multiedit|apply_patch|patch|str_replace|create_file|notebook_edit)$/i;

export interface ActiveEdit {
  chatId: string;
  /** File name of the document being edited, as Latte knows it. */
  fileName: string;
}

/** Files this chat is writing to at this instant. */
export function editsInProgress(messages: ChatMessage[], fileNames: string[]): string[] {
  if (fileNames.length === 0) return [];
  const editing = new Set<string>();
  // Only the last few messages matter: a tool that is still running is recent.
  for (const message of messages.slice(-6)) {
    for (const part of message.parts) {
      if (part.type !== 'tool' || part.status !== 'running') continue;
      if (!isEditTool(part)) continue;
      const haystack = `${part.title}\n${part.input}`.toLowerCase();
      for (const name of fileNames) {
        if (haystack.includes(name.toLowerCase())) editing.add(name);
      }
    }
  }
  return [...editing];
}

function isEditTool(part: Extract<ChatPart, { type: 'tool' }>): boolean {
  if (EDIT_TOOL.test(part.tool)) return true;
  // Codex reports file changes as `edit`; a shell command is not an edit even
  // if it mentions the file, so commands are deliberately excluded.
  return part.tool.toLowerCase() === 'edit';
}
