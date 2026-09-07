import { useEffect, useState } from 'react';
import type { DocumentState, WorkDocument } from '../shared/contracts';
import { api } from './browser-api';

/**
 * Whether each document of a work still matches the base it was derived from.
 *
 * A bounded sweep instead of a filesystem watcher: batches of six, never
 * overlapping, and stopped whenever the window is hidden or the view asking
 * for it is not the one on screen. Two views need this, so it lives here
 * rather than inside either of them.
 */
export function useDocumentStates(workId: string, documents: WorkDocument[], active: boolean) {
  const [states, setStates] = useState<Record<string, DocumentState>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState(0);
  const ids = documents.map(d => d.id).join('|');

  useEffect(() => {
    if (!active) return;
    let stopped = false, inFlight = false;
    const tick = async () => {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      setChecking(true);
      const next: Record<string, DocumentState> = {};
      const errors: string[] = [];
      for (let i = 0; i < documents.length && !stopped; i += 6) {
        const batch = documents.slice(i, i + 6);
        const results = await Promise.allSettled(batch.map(d => api.documentState(d.id)));
        results.forEach((r, j) => { if (r.status === 'fulfilled') next[batch[j].id] = r.value; else errors.push(batch[j].id); });
      }
      if (!stopped) { setStates(next); setFailed(errors); setChecking(false); }
      inFlight = false;
    };
    void tick();
    const timer = setInterval(() => void tick(), 5000);
    const focus = () => void tick();
    window.addEventListener('focus', focus);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [workId, ids, token, active]);

  return { states, failed, checking, refresh: () => setToken(n => n + 1) };
}
