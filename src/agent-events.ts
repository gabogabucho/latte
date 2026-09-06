import type { AgentEvent, LatteAPI } from '../shared/contracts';

const BUFFER_LIMIT = 512 * 1024;

type Listener = (event: AgentEvent) => void;

/**
 * One global subscription to terminal events, created before any session
 * starts. Output that arrives before a pane mounts (or while it is hidden)
 * is buffered per session and replayed on subscribe, so the first prompt of
 * a CLI is never lost to a race between startAgent() and the pane's effect.
 */
export function createAgentBus(api: Pick<LatteAPI, 'onAgentEvent'>) {
  const listeners = new Map<string, Set<Listener>>();
  const buffers = new Map<string, { chunks: string[]; size: number; ended: boolean }>();

  const bufferFor = (sessionId: string) => {
    let entry = buffers.get(sessionId);
    if (!entry) {
      entry = { chunks: [], size: 0, ended: false };
      buffers.set(sessionId, entry);
    }
    return entry;
  };

  api.onAgentEvent((event) => {
    const entry = bufferFor(event.sessionId);
    if (event.type === 'output') {
      entry.chunks.push(event.data);
      entry.size += event.data.length;
      while (entry.size > BUFFER_LIMIT && entry.chunks.length > 1) {
        entry.size -= entry.chunks[0].length;
        entry.chunks.shift();
      }
    } else if (event.type === 'exit') {
      entry.ended = true;
    }
    for (const listener of listeners.get(event.sessionId) ?? []) listener(event);
    for (const listener of listeners.get('*') ?? []) listener(event);
  });

  return {
    /** Subscribe to one session (or '*' for everything). Replays buffered output first. */
    subscribe(sessionId: string, listener: Listener, replay = true): () => void {
      if (replay && sessionId !== '*') {
        const entry = buffers.get(sessionId);
        if (entry) {
          for (const chunk of entry.chunks) listener({ sessionId, type: 'output', data: chunk });
        }
      }
      const set = listeners.get(sessionId) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(sessionId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(sessionId);
      };
    },
    hasEnded(sessionId: string): boolean {
      return buffers.get(sessionId)?.ended ?? false;
    },
    forget(sessionId: string): void {
      buffers.delete(sessionId);
    },
  };
}

export type AgentBus = ReturnType<typeof createAgentBus>;
