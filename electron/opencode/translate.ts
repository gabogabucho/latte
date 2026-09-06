import type { ChatMessage, ChatPart, ChatPermission, ChatQuestion, ChatStatus } from '../../shared/contracts';
import { isRecord, str, type OcMessage, type OcPart, type OcPermissionRequest, type OcQuestionRequest, type OcSessionStatus } from './wire';

const TOOL_TEXT_LIMIT = 12_000;

function clip(value: string): string {
  return value.length > TOOL_TEXT_LIMIT ? `${value.slice(0, TOOL_TEXT_LIMIT)}\n… [truncated]` : value;
}

function stringifyInput(input: unknown): string {
  if (input === undefined || input === null) return '';
  if (typeof input === 'string') return clip(input);
  try {
    return clip(JSON.stringify(input, null, 2));
  } catch {
    return '';
  }
}

/** Maps a wire part to a UI part; returns null for parts the UI does not render (steps, snapshots, patches). */
export function translatePart(part: OcPart): ChatPart | null {
  if (!isRecord(part) || typeof part.id !== 'string') return null;
  switch (part.type) {
    case 'text': {
      const text = 'text' in part ? str(part.text) : '';
      if ('ignored' in part && part.ignored === true) return null;
      return { type: 'text', id: part.id, text };
    }
    case 'reasoning':
      return { type: 'reasoning', id: part.id, text: 'text' in part ? str(part.text) : '' };
    case 'tool': {
      const state = 'state' in part && isRecord(part.state) ? part.state : { status: 'pending' };
      const status = state.status === 'running' || state.status === 'completed' || state.status === 'error' ? state.status : 'pending';
      return {
        type: 'tool',
        id: part.id,
        tool: 'tool' in part ? str(part.tool, 'tool') : 'tool',
        status,
        title: str(state.title),
        input: stringifyInput(state.input),
        output: clip(str(state.output)),
        error: str(state.error),
      };
    }
    default:
      return null;
  }
}

export function translateMessage(chatId: string, info: OcMessage, parts: OcPart[] = []): ChatMessage {
  const error = info.error ? describeMessageError(info.error) : null;
  return {
    id: info.id,
    chatId,
    role: info.role === 'user' ? 'user' : 'assistant',
    parts: parts.map(translatePart).filter((p): p is ChatPart => p !== null),
    createdAt: new Date(typeof info.time?.created === 'number' ? info.time.created : Date.now()).toISOString(),
    completed: info.role === 'user' ? true : typeof info.time?.completed === 'number' || Boolean(error),
    error,
  };
}

export function describeMessageError(error: unknown): string {
  if (!isRecord(error)) return 'Unknown error';
  const name = str(error.name, 'Error');
  const data = isRecord(error.data) ? error.data : {};
  const message = str(data.message);
  if (name === 'ProviderAuthError') {
    return `Provider authentication failed${data.providerID ? ` (${str(data.providerID)})` : ''}: ${message || 'run "opencode auth login" in a terminal'}`;
  }
  if (name === 'MessageAbortedError') return 'Response aborted';
  return message ? `${name}: ${message}` : name;
}

export function translateStatus(status: OcSessionStatus | undefined): { status: ChatStatus; detail: string } {
  if (!status || !isRecord(status)) return { status: 'idle', detail: '' };
  if (status.type === 'busy') return { status: 'busy', detail: '' };
  if (status.type === 'retry') return { status: 'retry', detail: `Retrying (attempt ${status.attempt}): ${status.message}` };
  return { status: 'idle', detail: '' };
}

export function translatePermission(request: OcPermissionRequest): ChatPermission {
  const metadata = isRecord(request.metadata) ? request.metadata : {};
  const patterns = Array.isArray(request.patterns) ? request.patterns.map((p) => str(p)).filter(Boolean) : [];
  return {
    id: request.id,
    permission: str(request.permission, 'unknown'),
    patterns,
    always: Array.isArray(request.always) ? request.always.map((p) => str(p)).filter(Boolean) : [],
    title: str(metadata.title) || str(metadata.description) || patterns.join(', '),
  };
}

export function translateQuestion(request: OcQuestionRequest): ChatQuestion {
  const questions = Array.isArray(request.questions) ? request.questions : [];
  return {
    id: request.id,
    questions: questions.filter(isRecord).map((q) => ({
      header: str(q.header),
      question: str(q.question),
      multiple: q.multiple === true,
      custom: q.custom === true,
      options: (Array.isArray(q.options) ? q.options : []).filter(isRecord).map((o) => ({ label: str(o.label), description: str(o.description) })),
    })),
  };
}
