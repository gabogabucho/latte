import type { Brand, Work, Revision, Decision, LatteAPI, WorkDocument, DocumentContent, SaveOutcome } from '../shared/contracts';
import { createAgentBus } from './agent-events';
import { createChatStore } from './chat-store';

const KEY = 'latte-preview-v1';
const initialBrief = '# Una nueva forma de habitar.\n\n_Brief de lanzamiento · Casa Oliva_\n\n## 01 / Objetivo\nPresentar la nueva colección a una audiencia que valora el diseño y la vida cotidiana.\n\n## 02 / Audiencia\nPersonas que eligen menos objetos, con más intención.\n\n## 03 / Propuesta\nDiseño que acompaña tu manera de vivir.\n\n> Hipótesis de ejemplo: contrastar con entrevistas antes de dar por validada.\n\n## 04 / Próximos pasos\n- [ ] Incorporar entrevistas reales\n- [ ] Revisar la propuesta de valor\n- [ ] Definir el primer experimento';
interface Store { brands: Brand[]; works: Work[]; revisions: Revision[]; decisions: Decision[] }
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
function read(): Store {
  const raw = localStorage.getItem(KEY);
  if (raw) return JSON.parse(raw);
  return { brands: [{ id: 'demo', name: 'Casa Oliva · Ejemplo', context: 'Marca ficticia de objetos de diseño. Tono cálido, preciso y cercano. Este espacio contiene material de demostración, no investigación real.', createdAt: now() }], works: [{ id: 'demo-work', brandId: 'demo', title: 'Lanzamiento primavera', brief: initialBrief, folder: null, updatedAt: now() }], revisions: [], decisions: [] };
}
function change<T>(fn: (store: Store) => T): T { const s = read(); const result = fn(s); localStorage.setItem(KEY, JSON.stringify(s)); return result; }
/** The web preview tracks a single brief document per work; the real model lives on the desktop. */
const previewDocId = (workId: string) => 'doc-' + workId;
const previewDocument = (w: Work): WorkDocument => ({ id: previewDocId(w.id), workId: w.id, kind: 'brief', title: w.title, fileName: 'brief.md', status: 'draft', baseDocumentId: null, baseRevisionId: null, baseFingerprint: null, createdAt: w.updatedAt, updatedAt: w.updatedAt });
const previewContent = async (documentId: string): Promise<DocumentContent> => { const w = read().works.find(w => previewDocId(w.id) === documentId)!; return { document: previewDocument(w), content: w.brief, fingerprint: String(w.brief.length), modifiedAt: null, baseOutdated: false }; };
const unavailable = async (): Promise<never> => { throw new Error('Los agentes reales están disponibles en la aplicación de escritorio. Esta vista es una previsualización local.'); };
export const browserAPI: LatteAPI = {
  appInfo: async () => ({ dataDir: '', engine: 'localStorage (vista previa)', engineReason: 'La vista web no usa SQLite', pack: null, packRoles: 0 }),
  listBrands: async () => read().brands,
  createBrand: async name => change(s => { const b = { id: id(), name, context: '', createdAt: now() }; s.brands.push(b); return b; }),
  updateBrand: async (brandId, context) => change(s => { const b = s.brands.find(b => b.id === brandId)!; b.context = context; return b; }),
  listWorks: async brandId => read().works.filter(w => w.brandId === brandId),
  createWork: async (brandId, title) => change(s => { const w: Work = { id: id(), brandId, title, brief: '# ' + title + '\n\n## Objetivo\n\n## Contexto\n\n## Próximos pasos\n', folder: null, updatedAt: now() }; s.works.push(w); return w; }),
  saveBrief: async (workId, brief): Promise<SaveOutcome> => change(s => { const w = s.works.find(w => w.id === workId)!; w.brief = brief; w.updatedAt = now(); return { status: 'saved', document: previewDocument(w), fingerprint: String(brief.length), work: w }; }),
  listRevisions: async workId => read().revisions.filter(r => r.workId === workId).reverse(),
  listDocuments: async workId => { const w = read().works.find(w => w.id === workId); return w ? [previewDocument(w)] : []; },
  readDocument: async documentId => previewContent(documentId),
  documentState: async documentId => { const c = await previewContent(documentId); return { documentId, fingerprint: c.fingerprint, modifiedAt: null, baseOutdated: false }; },
  createDocument: unavailable,
  saveDocument: async (documentId, content) => { const w = read().works.find(w => previewDocId(w.id) === documentId)!; return browserAPI.saveBrief(w.id, content); },
  updateDocument: unavailable,
  snapshotDocument: async documentId => { const w = read().works.find(w => previewDocId(w.id) === documentId)!; return browserAPI.snapshot(w.id); },
  listDocumentRevisions: async documentId => { const w = read().works.find(w => previewDocId(w.id) === documentId); return w ? read().revisions.filter(r => r.workId === w.id).reverse() : []; },
  exportDocument: async documentId => { const w = read().works.find(w => previewDocId(w.id) === documentId)!; return browserAPI.exportWork(w.id); },
  keepDraftAsVersion: unavailable,
  acknowledgeBase: unavailable,
  useFolder: unavailable,
  snapshot: async workId => change(s => { const r: Revision = { id: id(), workId, documentId: previewDocId(workId), source: 'human', content: s.works.find(w => w.id === workId)!.brief, createdAt: now() }; s.revisions.push(r); return r; }),
  listDecisions: async workId => read().decisions.filter(d => d.workId === workId),
  addDecision: async (workId, text) => change(s => { const d = { id: id(), workId, text, createdAt: now() }; s.decisions.push(d); return d; }),
  runtimeStatus: async () => ['claude', 'codex', 'opencode'].map(provider => ({ provider: provider as 'claude' | 'codex' | 'opencode', available: false, detail: 'Requiere escritorio' })),
  startAgent: unavailable, writeAgent: unavailable, resizeAgent: unavailable, stopAgent: unavailable,
  onAgentEvent: () => () => {},
  readMemory: async () => ({ available: false, text: 'Engram se conecta desde la aplicación de escritorio. Esta vista no simula recuerdos.' }),
  saveMemory: unavailable,
  exportWork: async workId => { const w = read().works.find(w => w.id === workId)!; const url = URL.createObjectURL(new Blob([w.brief], { type: 'text/markdown;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = w.title.replace(/[^\p{L}\p{N} -]/gu, '') + '.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return a.download; },
  // Structured chat needs the local OpenCode runtime: honest unavailable state in the browser preview.
  chatStatus: async () => ({ available: false, detail: 'El chat con agentes requiere Latte Desktop y OpenCode instalado.', version: null, models: [], defaultModel: null }),
  startChat: unavailable, listChatMessages: async () => [], sendChat: unavailable, abortChat: unavailable, stopChat: unavailable,
  replyPermission: unavailable, replyQuestion: unavailable,
  onChatEvent: () => () => {},
  reportUnsaved: () => {},
  windowControl: () => {},
  onWindowState: () => () => {},
  listProviders: async () => [], connectProviderKey: unavailable, disconnectProvider: unavailable, startProviderOAuth: unavailable, completeProviderOAuth: unavailable,
  getPrimaryAgent: async () => null, setPrimaryAgent: unavailable, listAgentRuntimes: async () => [], addAgentAccount: unavailable, removeAgentAccount: unavailable, startAccountLogin: unavailable, logoutAccount: unavailable,
  // The team roster is real only on desktop; the preview shows the roles so the concept is visible.
  listRoles: async () => [
    { id: 'assistant', name: 'Asistente', initial: 'A', summary: 'Trabaja el brief con vos sin un rol fijo. Es el punto de partida.', builtin: true },
    { id: 'strategist', name: 'Strategist', initial: 'S', summary: 'Compara opciones contra el objetivo y deja fundamentos, tradeoffs y próximos pasos.', builtin: false },
    { id: 'researcher', name: 'Researcher', initial: 'R', summary: 'Reúne y contrasta evidencia; devuelve fuentes, hallazgos y grado de certeza.', builtin: false },
    { id: 'analyst', name: 'Analyst', initial: 'A', summary: 'Interpreta datos ya disponibles; devuelve cálculos, supuestos y límites.', builtin: false },
    { id: 'reviewer', name: 'Reviewer', initial: 'V', summary: 'Revisa un entregable contra el brief; separa errores de hecho, desacuerdos estratégicos y estilo.', builtin: false },
  ],
  listTeam: async () => [], addTeamMember: unavailable, openTeamMember: unavailable, pauseTeamMember: unavailable, finishTeamMember: unavailable, removeTeamMember: unavailable,
};
export const api = window.latte ?? browserAPI;
export const isDesktop = Boolean(window.latte);
/** Global buses, created once so events emitted before a pane mounts are kept. */
export const agentBus = createAgentBus(api);
export const chatStore = createChatStore(api);
