import { useSyncExternalStore } from 'react';
import type { ChatEvent, ChatMessage, ChatPermission, ChatQuestion, ChatStatus, LatteAPI } from '../shared/contracts';

export interface ChatState {
  messages: ChatMessage[];
  /** What the human typed but has not sent. Lives here so the pane can unmount (Settings, member switch) without losing it. */
  draft: string;
  status: ChatStatus;
  statusDetail: string;
  permissions: ChatPermission[];
  questions: ChatQuestion[];
  error: string | null;
  closed: boolean;
}

const EMPTY: ChatState = { messages: [], draft: '', status: 'idle', statusDetail: '', permissions: [], questions: [], error: null, closed: false };

type Api = Pick<LatteAPI, 'onChatEvent' | 'listChatMessages'>;

/**
 * Renderer-side mirror of every chat, fed by one global event subscription
 * created at app start (so no event is lost while a pane is not mounted).
 * Messages are stored immutably per chat so React re-renders cheaply.
 */
export function createChatStore(api: Api) {
  const chats = new Map<string, ChatState>();
  const listeners = new Set<() => void>();

  const notify = () => { for (const l of listeners) l(); };
  const update = (chatId: string, fn: (state: ChatState) => ChatState) => {
    chats.set(chatId, fn(chats.get(chatId) ?? EMPTY));
    notify();
  };

  const upsertMessage = (messages: ChatMessage[], message: ChatMessage): ChatMessage[] => {
    const index = messages.findIndex((m) => m.id === message.id);
    if (index === -1) return [...messages, message];
    const next = messages.slice();
    next[index] = { ...message, parts: message.parts.length ? message.parts : messages[index].parts };
    return next;
  };

  api.onChatEvent((event: ChatEvent) => {
    switch (event.type) {
      case 'message':
        update(event.chatId, (s) => ({ ...s, messages: upsertMessage(s.messages, event.message) }));
        return;
      case 'part':
        update(event.chatId, (s) => {
          const messages = s.messages.slice();
          let index = messages.findIndex((m) => m.id === event.messageId);
          if (index === -1) {
            messages.push({ id: event.messageId, chatId: event.chatId, role: 'assistant', parts: [], createdAt: new Date().toISOString(), completed: false, error: null });
            index = messages.length - 1;
          }
          const message = messages[index];
          const parts = message.parts.slice();
          const partIndex = parts.findIndex((p) => p.id === event.part.id);
          if (partIndex === -1) parts.push(event.part); else parts[partIndex] = event.part;
          messages[index] = { ...message, parts };
          return { ...s, messages };
        });
        return;
      case 'delta':
        update(event.chatId, (s) => {
          const messages = s.messages.slice();
          let index = messages.findIndex((m) => m.id === event.messageId);
          if (index === -1) {
            messages.push({ id: event.messageId, chatId: event.chatId, role: 'assistant', parts: [], createdAt: new Date().toISOString(), completed: false, error: null });
            index = messages.length - 1;
          }
          const message = messages[index];
          const parts = message.parts.slice();
          const partIndex = parts.findIndex((p) => p.id === event.partId);
          if (partIndex === -1) parts.push({ type: 'text', id: event.partId, text: event.delta });
          else {
            const part = parts[partIndex];
            if (part.type === 'text' || part.type === 'reasoning') parts[partIndex] = { ...part, text: part.text + event.delta };
          }
          messages[index] = { ...message, parts };
          return { ...s, messages };
        });
        return;
      case 'status':
        update(event.chatId, (s) => ({ ...s, status: event.status, statusDetail: event.detail, error: event.status === 'busy' ? null : s.error }));
        return;
      case 'permission':
        update(event.chatId, (s) => ({ ...s, permissions: s.permissions.some((p) => p.id === event.request.id) ? s.permissions : [...s.permissions, event.request] }));
        return;
      case 'permission-resolved':
        update(event.chatId, (s) => ({ ...s, permissions: s.permissions.filter((p) => p.id !== event.requestId) }));
        return;
      case 'question':
        update(event.chatId, (s) => ({ ...s, questions: s.questions.some((q) => q.id === event.request.id) ? s.questions : [...s.questions, event.request] }));
        return;
      case 'question-resolved':
        update(event.chatId, (s) => ({ ...s, questions: s.questions.filter((q) => q.id !== event.requestId) }));
        return;
      case 'error':
        update(event.chatId, (s) => ({ ...s, error: event.message, status: 'idle' }));
        return;
      case 'closed':
        update(event.chatId, (s) => ({ ...s, closed: true, status: 'idle' }));
        return;
    }
  });

  return {
    get(chatId: string): ChatState {
      return chats.get(chatId) ?? EMPTY;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Pulls the authoritative history from the backend (e.g. right after a resume). */
    async sync(chatId: string): Promise<void> {
      const messages = await api.listChatMessages(chatId);
      update(chatId, (s) => ({ ...s, messages }));
    },
    setDraft(chatId: string, draft: string): void {
      update(chatId, (s) => ({ ...s, draft }));
    },
    clearError(chatId: string): void {
      update(chatId, (s) => ({ ...s, error: null }));
    },
    forget(chatId: string): void {
      chats.delete(chatId);
      notify();
    },
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;

export function useChatState(store: ChatStore, chatId: string | null): ChatState {
  return useSyncExternalStore(store.subscribe, () => (chatId ? store.get(chatId) : EMPTY), () => EMPTY);
}
