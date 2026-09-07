import type { Brand, Work, Revision, Decision, LatteAPI, WorkDocument, DocumentContent, SaveOutcome, AgentProfile, ProfileInput } from '../shared/contracts';
import { createAgentBus } from './agent-events';
import { createChatStore } from './chat-store';

const KEY = 'latte-preview-v1';
const initialBrief = '# Una nueva forma de habitar.\n\n_Brief de lanzamiento · Casa Oliva_\n\n## 01 / Objetivo\nPresentar la nueva colección a una audiencia que valora el diseño y la vida cotidiana.\n\n## 02 / Audiencia\nPersonas que eligen menos objetos, con más intención.\n\n## 03 / Propuesta\nDiseño que acompaña tu manera de vivir.\n\n> Hipótesis de ejemplo: contrastar con entrevistas antes de dar por validada.\n\n## 04 / Próximos pasos\n- [ ] Incorporar entrevistas reales\n- [ ] Revisar la propuesta de valor\n- [ ] Definir el primer experimento';
interface Store { brands: Brand[]; works: Work[]; revisions: Revision[]; decisions: Decision[]; documents?: WorkDocument[]; contents?: Record<string,string>; profiles?: AgentProfile[] }
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
const previewDocument = (w: Work): WorkDocument => ({ id: previewDocId(w.id), workId: w.id, kind: 'brief', title: w.title, fileName: 'brief.md', status: 'draft', funnelStages: [], baseDocumentId: null, baseRevisionId: null, baseFingerprint: null, createdAt: w.updatedAt, updatedAt: w.updatedAt });
function normalized(): Store & {documents:WorkDocument[];contents:Record<string,string>;profiles:AgentProfile[]} {
 const s=read();s.documents ??=[];s.contents ??={};s.profiles ??=[];
 for(const w of s.works)if(!s.documents.some(d=>d.id===previewDocId(w.id))){s.documents.push(previewDocument(w));s.contents[previewDocId(w.id)]=w.brief;}
 s.documents=s.documents.map(d=>({...d,funnelStages:d.funnelStages??[]}));
 return s as Store & {documents:WorkDocument[];contents:Record<string,string>;profiles:AgentProfile[]};
}
function mutate<T>(fn:(s:ReturnType<typeof normalized>)=>T):T {const s=normalized();const result=fn(s);localStorage.setItem(KEY,JSON.stringify(s));return result;}
const fingerprint=(text:string)=>text; // exact local comparison, including same-length edits
function contentFrom(s:ReturnType<typeof normalized>,documentId:string):DocumentContent {
 const d=s.documents.find(d=>d.id===documentId);if(!d)throw new Error('Documento no encontrado');
 return {document:d,content:s.contents[d.id]??'',fingerprint:fingerprint(s.contents[d.id]??''),modifiedAt:null,baseOutdated:Boolean(d.baseDocumentId && d.baseFingerprint!==fingerprint(s.contents[d.baseDocumentId]??''))};
}
const previewContent=async(documentId:string)=>contentFrom(normalized(),documentId);
function revision(s:ReturnType<typeof normalized>,documentId:string,content:string):Revision {const d=contentFrom(s,documentId).document;const r:Revision={id:id(),workId:d.workId,documentId,content,createdAt:now(),source:'human'};s.revisions.push(r);return r;}
const shippedRoles = [
 {id:'assistant',name:'Asistente',initial:'A',summary:'Trabaja el brief con vos sin un rol fijo.',builtin:true},
 {id:'strategist',name:'Strategist',initial:'S',summary:'Compara opciones y documenta decisiones.',builtin:false},
 {id:'researcher',name:'Researcher',initial:'R',summary:'Contrasta evidencia y fuentes.',builtin:false},
 {id:'analyst',name:'Analyst',initial:'A',summary:'Interpreta datos y explicita límites.',builtin:false},
 {id:'reviewer',name:'Reviewer',initial:'V',summary:'Revisa entregables contra el brief.',builtin:false},
];
const builtinProfiles:AgentProfile[]=shippedRoles.map(r=>({...r,soul:r.summary,skills:'',source:'builtin',directory:null,fingerprint:'builtin-'+r.id}));
function validateProfile(input:ProfileInput) {
 if(!/^[a-z][a-z0-9-]{0,47}$/.test(input.id)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(input.id))throw new Error('Identificador inválido');
 for(const [key,max] of [['name',80],['initial',4],['summary',500],['soul',100000],['skills',100000]] as const)if(typeof input[key]!=='string'||input[key].length>max || (key!=='skills'&&!input[key].trim()))throw new Error('Perfil inválido: '+key);
}
const unavailable = async (): Promise<never> => { throw new Error('Los agentes reales están disponibles en la aplicación de escritorio. Esta vista es una previsualización local.'); };
export const browserAPI: LatteAPI = {
  appInfo: async () => ({ dataDir: '', engine: 'localStorage (vista previa)', engineReason: 'La vista web no usa SQLite', pack: null, packRoles: 0 }),
  listBrands: async () => read().brands,
  createBrand: async name => change(s => { const b = { id: id(), name, context: '', createdAt: now() }; s.brands.push(b); return b; }),
  updateBrand: async (brandId, context) => change(s => { const b = s.brands.find(b => b.id === brandId)!; b.context = context; return b; }),
  listWorks: async brandId => read().works.filter(w => w.brandId === brandId),
  createWork: async (brandId, title) => change(s => { const w: Work = { id: id(), brandId, title, brief: '# ' + title + '\n\n## Objetivo\n\n## Contexto\n\n## Próximos pasos\n', folder: null, updatedAt: now() }; s.works.push(w); return w; }),
  saveBrief: async (workId, brief, baseFingerprint) => browserAPI.saveDocument(previewDocId(workId),brief,baseFingerprint??null),
  listRevisions: async workId => read().revisions.filter(r=>r.workId===workId).reverse(),
  listDocuments: async workId => normalized().documents.filter(d=>d.workId===workId),
  readDocument: previewContent,
  documentState: async documentId=>{const c=await previewContent(documentId);return {documentId,fingerprint:c.fingerprint,modifiedAt:null,baseOutdated:c.baseOutdated};},
  createDocument: async(workId,kind,title,baseDocumentId)=>mutate(s=>{
    if(!s.works.some(w=>w.id===workId))throw new Error('Trabajo no encontrado');
    const base=baseDocumentId?contentFrom(s,baseDocumentId):null;
    if(base&&base.document.workId!==workId)throw new Error('La base pertenece a otro trabajo');
    const documentId=id();const d:WorkDocument={id:documentId,workId,kind,title,fileName:kind+'-'+documentId+'.md',status:'draft',funnelStages:[],baseDocumentId:baseDocumentId??null,baseRevisionId:null,baseFingerprint:base?.fingerprint??null,createdAt:now(),updatedAt:now()};
    s.documents.push(d);s.contents[d.id]='# '+title+'\n';return contentFrom(s,d.id);
  }),
  saveDocument: async(documentId,content,baseFingerprint):Promise<SaveOutcome>=>mutate(s=>{const disk=contentFrom(s,documentId);if(baseFingerprint!==null&&baseFingerprint!==disk.fingerprint)return {status:'conflict',document:disk.document,disk,keptRevision:revision(s,documentId,disk.content)};s.contents[documentId]=content;const work=s.works.find(w=>w.id===disk.document.workId)!;if(disk.document.kind==='brief')work.brief=content;work.updatedAt=now();disk.document.updatedAt=now();return {status:'saved',document:disk.document,fingerprint:fingerprint(content),work};}),
  updateDocument: async(documentId,patch)=>mutate(s=>{const d=contentFrom(s,documentId).document;
   if(patch.title!==undefined&&(typeof patch.title!=='string'||!patch.title.trim()||patch.title.length>120))throw new Error('Título inválido');
   if(patch.status!==undefined&&!['draft','review','approved'].includes(patch.status))throw new Error('Estado inválido');
   if(patch.funnelStages!==undefined&&(!Array.isArray(patch.funnelStages)||patch.funnelStages.length>4||patch.funnelStages.some(x=>!['discovery','consideration','conversion','retention'].includes(x))))throw new Error('Etapa inválida');
   if(patch.title!==undefined)d.title=patch.title.trim();if(patch.status!==undefined)d.status=patch.status;if(patch.funnelStages!==undefined)d.funnelStages=[...new Set(patch.funnelStages)];d.updatedAt=now();return d;
  }),
  snapshotDocument: async documentId=>mutate(s=>revision(s,documentId,contentFrom(s,documentId).content)),
  listDocumentRevisions: async documentId=>read().revisions.filter(r=>r.documentId===documentId).reverse(),
  exportDocument: async documentId=>{const c=await previewContent(documentId);const url=URL.createObjectURL(new Blob([c.content],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=c.document.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return a.download;},
  keepDraftAsVersion: async(documentId,content)=>mutate(s=>revision(s,documentId,content)),
  listUntrackedFiles: async()=>[],trackFile:unavailable,
  saveAsDocument:async(workId,kind,title,content)=>{const c=await browserAPI.createDocument(workId,kind,title);await browserAPI.saveDocument(c.document.id,content,c.fingerprint);return c.document;},
  getFolderTrust:async()=>false,setFolderTrust:unavailable,
  acknowledgeBase:async documentId=>mutate(s=>{const d=contentFrom(s,documentId).document;if(d.baseDocumentId)d.baseFingerprint=contentFrom(s,d.baseDocumentId).fingerprint;return d;}),
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
  listMcpServers: async () => [], addMcpServer: unavailable, removeMcpServer: unavailable,
  getPrimaryAgent: async () => null, setPrimaryAgent: unavailable, listAgentRuntimes: async () => [], addAgentAccount: unavailable, removeAgentAccount: unavailable, startAccountLogin: unavailable, logoutAccount: unavailable,
  // The team roster is real only on desktop; the preview shows the roles so the concept is visible.
  listRoles: async()=> (await browserAPI.listProfiles()).map(({id,name,initial,summary,builtin})=>({id,name,initial,summary,builtin})),
  listProfiles:async()=>[...builtinProfiles,...normalized().profiles],
  saveProfile:async(input,expectedFingerprint)=>mutate(s=>{validateProfile(input);if(shippedRoles.some(r=>r.id===input.id))throw new Error('Los perfiles incluidos son de solo lectura');const existing=s.profiles.find(p=>p.id===input.id);if(expectedFingerprint===null?Boolean(existing):!existing||existing.fingerprint!==expectedFingerprint)throw new Error('El perfil cambió o ya existe. Tu borrador sigue intacto; recargá antes de reintentar.');const p:AgentProfile={...input,builtin:false,source:'custom',directory:null,fingerprint:id()};s.profiles=s.profiles.filter(p=>p.id!==input.id);s.profiles.push(p);return p;}),
  listTeam: async () => [], addTeamMember: unavailable, openTeamMember: unavailable, pauseTeamMember: unavailable, finishTeamMember: unavailable, removeTeamMember: unavailable,
};
export const api = window.latte ?? browserAPI;
export const isDesktop = Boolean(window.latte);
/** Global buses, created once so events emitted before a pane mounts are kept. */
export const agentBus = createAgentBus(api);
export const chatStore = createChatStore(api);
