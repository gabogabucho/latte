import type { ChatMessage, ChatRuntime, ChatSession, PermissionReply } from '../../shared/contracts';

export interface AdapterStartInput {
  workId: string;
  /** Chat id to use (the team member id, stable across resumes). Adapters mint one when absent. */
  chatId?: string;
  /** Work directory: the agent's cwd and the only place it should write. */
  directory: string;
  title: string;
  /** Role the member plays; echoed on the session for the UI. */
  roleId?: string;
  roleName?: string;
  /** Role personality, appended to the runtime's system prompt for this chat only. Empty = plain chat. */
  instructions?: string;
  /** Runtime-native session/thread id persisted from an earlier run, if any. */
  previousSessionId?: string | null;
  /** Runtime-specific model id; null = runtime default. */
  model?: string | null;
  /** Latte-managed account (Claude Code / Codex); null = system profile / not applicable. */
  accountId?: string | null;
  /** Human label shown in the chat header. */
  label: string;
  /**
   * The human granted this work permission to read and write inside its own
   * folder. Verified against Claude Code: the grant is scoped to the folder,
   * so anything outside it, and every other tool, still asks.
   */
  trustedFolder?: boolean;
  /** Extra environment for the agent process (ENGRAM_PROJECT etc.). */
  extraEnv?: Record<string, string>;
}

export interface AdapterStartResult {
  session: ChatSession;
  /** Runtime-native id to persist for resume; empty when the runtime assigns it later. */
  runtimeSessionId: string;
}

/**
 * One implementation per runtime (OpenCode server, Claude Code stream-json,
 * Codex app-server). The hub routes by chat id; the UI only ever sees
 * ChatEvents, so every runtime looks the same on screen.
 */
/** Session fields every adapter fills the same way from the start input. */
export function sessionFrom(input: AdapterStartInput, provider: ChatRuntime, model: string | null, accountId: string | null, label: string, resumed: boolean): ChatSession {
  return {
    // Runtimes that replay their own history (OpenCode, Codex) recover it whenever they resume.
    historyRecovered: resumed,
    id: input.chatId ?? '',
    workId: input.workId,
    provider,
    model,
    accountId,
    label,
    resumed,
    roleId: input.roleId ?? 'assistant',
    roleName: input.roleName ?? 'Asistente',
  };
}

export interface RuntimeAdapter {
  readonly runtime: ChatRuntime;
  start(input: AdapterStartInput): Promise<AdapterStartResult>;
  owns(chatId: string): boolean;
  /** True while the runtime is answering on this chat. */
  isBusy(chatId: string): boolean;
  listMessages(chatId: string): ChatMessage[];
  send(chatId: string, text: string): Promise<void>;
  abort(chatId: string): Promise<void>;
  replyPermission(chatId: string, requestId: string, reply: PermissionReply): Promise<void>;
  replyQuestion(chatId: string, requestId: string, answers: string[][] | null): Promise<void>;
  stop(chatId: string): void;
  shutdown(): void;
}
