export type Provider = 'claude' | 'codex' | 'opencode';
export interface Brand { id: string; name: string; context: string; createdAt: string }
export interface Work { id: string; brandId: string; title: string; brief: string; updatedAt: string }
/** Where a stored version came from. `external` = the file changed outside Latte; we never guess who wrote it. */
export type RevisionSource = 'human' | 'external' | 'latte';
export interface Revision { id: string; workId: string; documentId: string; source: RevisionSource; content: string; createdAt: string }

// --- Documents: a work holds one or more tracked Markdown deliverables ---------

/** `brief` is the default document of every work. The rest are optional. */
export type DocumentKind = 'brief' | 'strategy' | 'calendar' | 'research' | 'copy' | 'note';
export type DocumentStatus = 'draft' | 'review' | 'approved';
export interface WorkDocument {
  id: string;
  workId: string;
  kind: DocumentKind;
  title: string;
  /** Latte-generated file name inside the work directory (e.g. `strategy.md`). */
  fileName: string;
  status: DocumentStatus;
  /** Document this one was derived from (a calendar built on a strategy). */
  baseDocumentId: string | null;
  /** Exact version of the base document used, so a later change is visible as "needs review". */
  baseRevisionId: string | null;
  baseFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}
/** Content plus the fingerprint a later save must present to prove it edited this version. */
export interface DocumentContent {
  document: WorkDocument;
  content: string;
  fingerprint: string;
  modifiedAt: string | null;
  /** True when the base document moved on since this document declared its base version. */
  baseOutdated: boolean;
}
/** Cheap poll answer used to notice external edits without a filesystem watcher. */
export interface DocumentState { documentId: string; fingerprint: string; modifiedAt: string | null; baseOutdated: boolean }
/**
 * A save never overwrites silently. On `conflict` the disk version is kept as
 * an immutable revision, the editor keeps the human draft, and the user picks.
 */
export type SaveOutcome =
  | { status: 'saved'; document: WorkDocument; fingerprint: string; work: Work }
  | { status: 'conflict'; document: WorkDocument; disk: DocumentContent; keptRevision: Revision };
export interface Decision { id: string; workId: string; text: string; createdAt: string }
export interface AgentEvent { sessionId: string; type: 'output' | 'exit' | 'error'; data: string }
export interface AgentSession { id: string; provider: Provider; workId: string }
export interface RuntimeStatus { provider: Provider; available: boolean; detail: string }
export interface MemoryResult { available: boolean; text: string }
/** Read-only facts about this installation, shown in the Settings screen. */
export interface AppInfo { dataDir: string; engine: string; engineReason: string; pack: string | null; packRoles: number }

// --- Structured chat (OpenCode runtime underneath, native Latte UI on top) ---

export type ChatRole = 'user' | 'assistant';
export type ChatToolStatus = 'pending' | 'running' | 'completed' | 'error';
export type ChatPart =
  | { type: 'text'; id: string; text: string }
  | { type: 'reasoning'; id: string; text: string }
  | { type: 'tool'; id: string; tool: string; status: ChatToolStatus; title: string; input: string; output: string; error: string };
export interface ChatMessage { id: string; chatId: string; role: ChatRole; parts: ChatPart[]; createdAt: string; completed: boolean; error: string | null }
/** Which local runtime drives a chat: OpenCode (API-key providers), Claude Code or Codex (their own subscription logins). */
export type ChatRuntime = 'opencode' | 'claude' | 'codex';
/**
 * A live conversation. Its id is the team member's id, so it stays stable
 * across pause/resume and app restarts.
 */
export interface ChatSession { id: string; workId: string; provider: ChatRuntime; model: string | null; accountId: string | null; label: string; resumed: boolean; roleId: string; roleName: string; /** On a resume: whether earlier messages could be shown again. False means the runtime kept its context but Latte has no local record. */ historyRecovered: boolean }

// --- Team: roles with a preset personality, one conversation each ---------------

/** A preset personality a team member opens with. Shipped by the discipline pack; `assistant` is the neutral default. */
export interface AgentRole { id: string; name: string; initial: string; summary: string; builtin: boolean }
/** working = answering now · idle = open and waiting · paused = closed, resumable · ended = finished by the user (can be reopened). */
export type TeamMemberStatus = 'working' | 'idle' | 'paused' | 'ended';
/** A role opened inside a work: its own conversation, runtime, account and status. Persisted and resumable. */
export interface TeamMember {
  id: string;
  workId: string;
  roleId: string;
  roleName: string;
  initial: string;
  runtime: ChatRuntime;
  model: string | null;
  accountId: string | null;
  label: string;
  status: TeamMemberStatus;
  createdAt: string;
  updatedAt: string;
}
/** Advanced overrides when adding a member; empty = the primary agent. */
export interface TeamMemberOptions { runtime?: ChatRuntime | null; model?: string | null; accountId?: string | null }
/** The agent a new chat starts with. Chosen once in the Providers screen, never asked per chat. */
export interface PrimaryAgent { runtime: ChatRuntime; model: string | null; accountId: string | null; label: string }
/** A Claude Code / Codex login. `system` = the user's own CLI profile; otherwise a Latte-managed profile directory. */
export interface AgentAccount { runtime: 'claude' | 'codex'; id: string; label: string; system: boolean; loggedIn: boolean; detail: string }
export interface AgentRuntimeInfo { runtime: 'claude' | 'codex'; installed: boolean; version: string | null; detail: string; accounts: AgentAccount[] }
export type AccountLoginStart =
  | { mode: 'terminal'; sessionId: string; instructions: string }
  | { mode: 'browser'; url: string; instructions: string };
export interface ChatPermission { id: string; permission: string; patterns: string[]; always: string[]; title: string }
export interface ChatQuestionOption { label: string; description: string }
export interface ChatQuestionItem { header: string; question: string; options: ChatQuestionOption[]; multiple: boolean; custom: boolean }
export interface ChatQuestion { id: string; questions: ChatQuestionItem[] }
export type ChatStatus = 'idle' | 'busy' | 'retry';
export type ChatEvent =
  | { chatId: string; type: 'message'; message: ChatMessage }
  | { chatId: string; type: 'part'; messageId: string; part: ChatPart }
  | { chatId: string; type: 'delta'; messageId: string; partId: string; delta: string }
  | { chatId: string; type: 'status'; status: ChatStatus; detail: string }
  | { chatId: string; type: 'permission'; request: ChatPermission }
  | { chatId: string; type: 'permission-resolved'; requestId: string }
  | { chatId: string; type: 'question'; request: ChatQuestion }
  | { chatId: string; type: 'question-resolved'; requestId: string }
  | { chatId: string; type: 'error'; message: string }
  | { chatId: string; type: 'closed'; reason: string };
export type PermissionReply = 'once' | 'always' | 'reject';
export interface ChatRuntimeStatus { available: boolean; detail: string; version: string | null; models: string[]; defaultModel: string | null }

// --- Providers (managed by the OpenCode runtime; Latte is only the UI, never the vault) ---

export interface ProviderPrompt { key: string; type: 'text' | 'select'; message: string; placeholder: string; options: Array<{ label: string; value: string; hint: string }> }
export interface ProviderAuthMethod { index: number; type: 'oauth' | 'api'; label: string; prompts: ProviderPrompt[] }
export interface ProviderInfo { id: string; name: string; connected: boolean; models: string[]; methods: ProviderAuthMethod[] }
export interface ProviderOAuthStart { url: string; method: 'auto' | 'code'; instructions: string }

export interface LatteAPI {
  appInfo(): Promise<AppInfo>;
  listBrands(): Promise<Brand[]>;
  createBrand(name: string): Promise<Brand>;
  updateBrand(id: string, context: string): Promise<Brand>;
  listWorks(brandId: string): Promise<Work[]>;
  createWork(brandId: string, title: string): Promise<Work>;
  /** Saves the work's brief document. `baseFingerprint` is the one handed out by the last read; omitting it falls back to the database copy. */
  saveBrief(workId: string, brief: string, baseFingerprint?: string | null): Promise<SaveOutcome>;
  listRevisions(workId: string): Promise<Revision[]>;
  snapshot(workId: string): Promise<Revision>;
  // Documents
  listDocuments(workId: string): Promise<WorkDocument[]>;
  readDocument(documentId: string): Promise<DocumentContent>;
  /** Cheap: only the fingerprint, for noticing external edits. */
  documentState(documentId: string): Promise<DocumentState>;
  createDocument(workId: string, kind: DocumentKind, title: string, baseDocumentId?: string | null): Promise<DocumentContent>;
  saveDocument(documentId: string, content: string, baseFingerprint: string | null): Promise<SaveOutcome>;
  updateDocument(documentId: string, patch: { title?: string; status?: DocumentStatus }): Promise<WorkDocument>;
  snapshotDocument(documentId: string): Promise<Revision>;
  /** Keeps an editor draft as an immutable version without writing the file: used to resolve a conflict without losing the human's text. */
  keepDraftAsVersion(documentId: string, content: string): Promise<Revision>;
  listDocumentRevisions(documentId: string): Promise<Revision[]>;
  exportDocument(documentId: string): Promise<string | null>;
  /** Re-points a derived document at the current version of its base, after the human reviewed the change. */
  acknowledgeBase(documentId: string): Promise<WorkDocument>;
  listDecisions(workId: string): Promise<Decision[]>;
  addDecision(workId: string, text: string): Promise<Decision>;
  runtimeStatus(): Promise<RuntimeStatus[]>;
  startAgent(workId: string, provider: Provider): Promise<AgentSession>;
  writeAgent(sessionId: string, data: string): Promise<void>;
  resizeAgent(sessionId: string, cols: number, rows: number): Promise<void>;
  stopAgent(sessionId: string): Promise<void>;
  onAgentEvent(callback: (event: AgentEvent) => void): () => void;
  readMemory(brandId: string): Promise<MemoryResult>;
  saveMemory(brandId: string, text: string): Promise<MemoryResult>;
  exportWork(workId: string): Promise<string | null>;
  // Structured chat
  chatStatus(): Promise<ChatRuntimeStatus>;
  /** Adds a neutral "assistant" member with the primary agent and opens it. Overrides exist for tests and advanced use; the UI never asks. */
  startChat(workId: string, model?: string | null, runtime?: ChatRuntime | null, accountId?: string | null): Promise<ChatSession>;
  // Team (roles per work)
  listRoles(): Promise<AgentRole[]>;
  listTeam(workId: string): Promise<TeamMember[]>;
  /** Creates a member for the role (primary agent unless overridden) and opens its conversation. */
  addTeamMember(workId: string, roleId: string, options?: TeamMemberOptions | null): Promise<ChatSession>;
  /** Opens (or resumes) an existing member's conversation. Idempotent while it is already open. */
  openTeamMember(memberId: string): Promise<ChatSession>;
  /** Closes the conversation; the member stays listed and can be resumed. */
  pauseTeamMember(memberId: string): Promise<void>;
  /** Closes the conversation and marks the member as finished. */
  finishTeamMember(memberId: string): Promise<void>;
  removeTeamMember(memberId: string): Promise<void>;
  listChatMessages(chatId: string): Promise<ChatMessage[]>;
  sendChat(chatId: string, text: string): Promise<void>;
  abortChat(chatId: string): Promise<void>;
  stopChat(chatId: string): Promise<void>;
  replyPermission(chatId: string, requestId: string, reply: PermissionReply): Promise<void>;
  replyQuestion(chatId: string, requestId: string, answers: string[][] | null): Promise<void>;
  onChatEvent(callback: (event: ChatEvent) => void): () => void;
  /**
   * Tells the main process whether closing now would lose work. Electron does
   * not show a dialog for a cancelled `beforeunload`, so the window would just
   * refuse to close; the confirmation is a native dialog instead.
   */
  reportUnsaved(hasUnsavedWork: boolean): void;
  // Providers
  listProviders(): Promise<ProviderInfo[]>;
  /** Stores an API key in the runtime's own credential store (Latte never persists it). */
  connectProviderKey(providerId: string, key: string): Promise<void>;
  disconnectProvider(providerId: string): Promise<void>;
  /** Starts an OAuth login; the URL is also opened in the system browser. */
  startProviderOAuth(providerId: string, methodIndex: number, inputs: Record<string, string>): Promise<ProviderOAuthStart>;
  /** Completes an OAuth login (code is required only when the start returned method "code"). */
  completeProviderOAuth(providerId: string, methodIndex: number, code: string | null): Promise<void>;
  // Primary agent + subscription runtimes (Claude Code, Codex)
  getPrimaryAgent(): Promise<PrimaryAgent | null>;
  setPrimaryAgent(choice: { runtime: ChatRuntime; model: string | null; accountId: string | null }): Promise<PrimaryAgent>;
  listAgentRuntimes(): Promise<AgentRuntimeInfo[]>;
  addAgentAccount(runtime: 'claude' | 'codex', label: string): Promise<AgentAccount>;
  removeAgentAccount(runtime: 'claude' | 'codex', accountId: string): Promise<void>;
  /** Starts the runtime's own login (browser OAuth). Claude runs inside an embedded terminal session; Codex returns a URL. */
  startAccountLogin(runtime: 'claude' | 'codex', accountId: string): Promise<AccountLoginStart>;
  logoutAccount(runtime: 'claude' | 'codex', accountId: string): Promise<void>;
}
declare global { interface Window { latte?: LatteAPI } }
