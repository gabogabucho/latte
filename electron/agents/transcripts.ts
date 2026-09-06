import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from '../../shared/contracts';

const MAX_MESSAGES = 400;
const MAX_LINE_BYTES = 256 * 1024;
const CHAT_ID = /^[a-z][a-z0-9_-]{2,63}$/;

/**
 * A local, append-only record of what a chat showed, one file per chat.
 *
 * Only runtimes that cannot replay their own history use it (Claude Code:
 * `--resume` restores the model's context but the CLI streams nothing about
 * earlier turns, so the pane would come back empty). OpenCode and Codex load
 * their history from the runtime and never touch this store, which is what
 * keeps messages from being duplicated.
 *
 * The file name is the chat id (= team member id), so two members, two works
 * or two brands can never read each other's transcript.
 */
export class TranscriptStore {
  constructor(private readonly root: string) {}

  private fileFor(chatId: string): string | null {
    if (!CHAT_ID.test(chatId)) return null;
    return path.join(this.root, `${chatId}.jsonl`);
  }

  /** Messages recorded earlier, oldest first. Unreadable or partial lines are skipped, never guessed. */
  load(chatId: string): ChatMessage[] {
    const file = this.fileFor(chatId);
    if (!file || !fs.existsSync(file)) return [];
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const byId = new Map<string, ChatMessage>();
    const order: string[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const message = asMessage(parsed);
      if (!message) continue;
      if (!byId.has(message.id)) order.push(message.id);
      byId.set(message.id, message);
    }
    const messages = order.map((id) => byId.get(id)).filter((m): m is ChatMessage => m !== undefined);
    return messages.slice(-MAX_MESSAGES);
  }

  /** Appends one message. Re-appending the same id is how an updated turn replaces the earlier line. */
  append(chatId: string, message: ChatMessage): void {
    const file = this.fileFor(chatId);
    if (!file) return;
    let line: string;
    try {
      line = JSON.stringify(message);
    } catch {
      return;
    }
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) return;
    try {
      fs.mkdirSync(this.root, { recursive: true });
      fs.appendFileSync(file, `${line}\n`);
    } catch {
      /* a transcript is a convenience, never a reason to break a chat */
    }
  }

  /** Called when a member is removed: their transcript goes with them. */
  forget(chatId: string): void {
    const file = this.fileFor(chatId);
    if (!file) return;
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function asMessage(value: unknown): ChatMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Partial<ChatMessage>;
  if (typeof m.id !== 'string' || typeof m.chatId !== 'string') return null;
  if (m.role !== 'user' && m.role !== 'assistant') return null;
  if (!Array.isArray(m.parts)) return null;
  return {
    id: m.id,
    chatId: m.chatId,
    role: m.role,
    parts: m.parts,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
    completed: m.completed !== false,
    error: typeof m.error === 'string' ? m.error : null,
  };
}
