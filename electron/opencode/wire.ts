/**
 * The subset of the OpenCode server protocol Latte consumes. Shapes follow the
 * OpenAPI document served by the installed runtime (see docs/qa-opencode-openapi.json).
 * Everything is treated as untrusted input and narrowed before use.
 */

export interface OcSession {
  id: string;
  title?: string;
  directory?: string;
  model?: { id?: string; providerID?: string };
  time?: { created?: number; updated?: number };
}

export interface OcTextPart { id: string; sessionID: string; messageID: string; type: 'text'; text: string; synthetic?: boolean; ignored?: boolean }
export interface OcReasoningPart { id: string; sessionID: string; messageID: string; type: 'reasoning'; text: string }
export interface OcToolState {
  status: 'pending' | 'running' | 'completed' | 'error';
  input?: Record<string, unknown>;
  title?: string;
  output?: string;
  error?: string;
}
export interface OcToolPart { id: string; sessionID: string; messageID: string; type: 'tool'; callID: string; tool: string; state: OcToolState }
export interface OcOtherPart { id: string; sessionID: string; messageID: string; type: string }
export type OcPart = OcTextPart | OcReasoningPart | OcToolPart | OcOtherPart;

export interface OcMessageError { name?: string; data?: { message?: string; providerID?: string } }
/**
 * What an assistant message consumed, as the server counts it. `reasoning` is
 * a breakdown of `output`, not an extra amount, so it is never added on top.
 */
export interface OcTokens { total?: number; input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
export interface OcMessage {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant';
  time: { created: number; completed?: number };
  error?: OcMessageError;
  modelID?: string;
  providerID?: string;
  /** Assistant messages only: the price the server itself computed, in USD. */
  cost?: number;
  tokens?: OcTokens;
}

export interface OcMessageWithParts { info: OcMessage; parts: OcPart[] }

export interface OcPermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  always: string[];
  metadata?: Record<string, unknown>;
}

export interface OcQuestionOption { label: string; description?: string }
export interface OcQuestionInfo { question: string; header: string; options: OcQuestionOption[]; multiple?: boolean; custom?: boolean }
export interface OcQuestionRequest { id: string; sessionID: string; questions: OcQuestionInfo[] }

export type OcSessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number };

export interface OcEvent { id?: string; type: string; properties: Record<string, unknown> }
export interface OcGlobalEvent { directory?: string; project?: string; payload: OcEvent }

export interface OcModel { id: string; providerID?: string; name?: string }
export interface OcProvider { id: string; name: string; source: string; models: Record<string, OcModel> }
export interface OcProvidersResponse { providers: OcProvider[]; default: Record<string, string> }
export interface OcProviderCatalog { all: OcProvider[]; connected: string[]; default: Record<string, string> }

export interface OcAuthPrompt {
  type: 'text' | 'select';
  key: string;
  message: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string; hint?: string }>;
}
export interface OcAuthMethod { type: 'oauth' | 'api'; label: string; prompts?: OcAuthPrompt[] }
export interface OcOAuthAuthorization { url: string; method: 'auto' | 'code'; instructions: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
