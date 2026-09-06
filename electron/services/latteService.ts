import type {
  AccountLoginStart,
  AgentAccount,
  AppInfo,
  AgentRole,
  AgentRuntimeInfo,
  AgentSession,
  Brand,
  ChatMessage,
  ChatRuntime,
  ChatRuntimeStatus,
  ChatSession,
  Decision,
  DocumentContent,
  FolderLinkResult,
  DocumentKind,
  DocumentState,
  DocumentStatus,
  LatteAPI,
  McpRuntimeTools,
  McpServerInput,
  MemoryResult,
  PermissionReply,
  PrimaryAgent,
  Provider,
  ProviderInfo,
  ProviderOAuthStart,
  Revision,
  RevisionSource,
  RuntimeStatus,
  SaveOutcome,
  TeamMember,
  TeamMemberOptions,
  UntrackedFile,
  Work,
  WorkDocument,
} from '../../shared/contracts';
import nodePath from 'node:path';
import { writeFileAtomic } from '../core/atomicFile';
import { UnavailableError, ValidationError } from '../core/errors';
import { newId, nowIso, slugify } from '../core/ids';
import { WORK_FILES } from '../core/paths';
import { EngramClient, memoryProjectFor } from '../memory/engram';
import { AccountStore } from '../agents/accounts';
import { isAccountRuntime, isChatRuntime, type AgentHub, type MemberContext } from '../agents/hub';
import type { McpCatalog } from '../agents/mcp';
import { RoleCatalog } from '../agents/roles';
import type { ChatManager } from '../opencode/chatManager';
import { RuntimeDetector } from '../runtime/detect';
import { assertProvider } from '../runtime/providers';
import { TerminalManager } from '../runtime/terminalManager';
import { briefDocumentId, type DocumentRecord, type LatteRepository } from '../storage/repository';
import { renderInstructions, type InstructionPack } from '../workspace/instructions';
import { checkFolder, kindFromFileName, scanFolder, titleFromFileName } from '../workspace/linkFolder';
import { renderDocumentTemplate } from '../workspace/templates';
import { documentFileName, fingerprintOf, type DocumentOnDisk, type WorkspaceFiles } from '../workspace/workspace';
import { LIMITS, requireId, requireInt, requireLabel, requireRequestId, requireText } from './validation';

/** Everything the renderer can call, minus the event subscriptions (wired in the preload). */
export type BackendApi = Omit<LatteAPI, 'onAgentEvent' | 'onChatEvent' | 'reportUnsaved' | 'windowControl' | 'onWindowState'>;

export interface LatteServiceDeps {
  repo: LatteRepository;
  files: WorkspaceFiles;
  detector: RuntimeDetector;
  terminal: TerminalManager;
  /** OpenCode runtime (providers, status). */
  chat: ChatManager;
  /** Routes chats across OpenCode / Claude Code / Codex and owns the primary agent. */
  hub: AgentHub;
  engram: EngramClient;
  /** MCP servers, read and written through each runtime's own CLI. */
  mcp?: McpCatalog;
  /** Opens a native save dialog; returns the chosen path or null on cancel. */
  chooseExportPath: (suggestedFileName: string) => Promise<string | null>;
  /** Opens a native folder picker; returns the chosen folder or null on cancel. */
  chooseFolder?: (title: string) => Promise<string | null>;
  /** Discipline pack prepended to every generated instruction file. */
  pack?: InstructionPack | null;
  /** Opens an http(s) URL in the system browser (OAuth logins). */
  openExternal?: (url: string) => Promise<void>;
  /** Why the storage engine was chosen (shown read-only in Settings). */
  engineReason?: string;
  clock?: () => string;
}

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const FINGERPRINT = /^[a-f0-9]{16}$/;
/** Per-work grant, kept in `meta` so no schema change is needed to add it. */
const FOLDER_TRUST_KEY = 'trust-folder:';
const DOCUMENT_KINDS: DocumentKind[] = ['brief', 'strategy', 'calendar', 'research', 'copy', 'note'];
const DOCUMENT_STATUSES: DocumentStatus[] = ['draft', 'review', 'approved'];

/** A kind guessed from a file name is only accepted when Latte knows it. */
function kindOf(value: string): DocumentKind {
  return (DOCUMENT_KINDS as string[]).includes(value) ? (value as DocumentKind) : 'note';
}

function requireProviderId(value: unknown): string {
  if (typeof value !== 'string' || !PROVIDER_ID.test(value)) throw new TypeError('Invalid provider id');
  return value;
}

/** Advanced overrides for a new member; every field is optional and strictly typed. */
function validateMemberOptions(options: unknown): { runtime: ChatRuntime | null; model: string | null; accountId: string | null } {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new TypeError('Invalid options');
  const { runtime, model, accountId } = options as Record<string, unknown>;
  const cleanRuntime = runtime === undefined || runtime === null ? null : runtime;
  if (cleanRuntime !== null && !isChatRuntime(cleanRuntime)) throw new TypeError('Unknown runtime');
  const cleanModel = model === undefined || model === null ? null : model;
  if (cleanModel !== null && (typeof cleanModel !== 'string' || cleanModel.length === 0 || cleanModel.length > 200 || /[\s\0]/.test(cleanModel))) throw new TypeError('Invalid model id');
  const cleanAccount = accountId === undefined || accountId === null ? null : accountId;
  if (cleanAccount !== null && !AccountStore.isValidId(cleanAccount)) throw new TypeError('Invalid account id');
  return { runtime: cleanRuntime, model: cleanModel as string | null, accountId: cleanAccount as string | null };
}

/**
 * Document model (matches the UI): `Work.brief` IS the editable Markdown
 * deliverable. On disk it lives in `brief.md`, which agents edit from their
 * sessions. The file is the single authority: every read path syncs the
 * database copy from disk, so agent edits show up in the UI on refresh.
 *
 * Instruction files (CLAUDE.md / AGENTS.md) are generated when a work is
 * created and rewritten when a NEW agent session starts. Edits made while a
 * session is running deliberately do not touch files that session is reading.
 */
export class LatteService implements BackendApi {
  private readonly clock: () => string;

  constructor(private readonly deps: LatteServiceDeps) {
    this.clock = deps.clock ?? nowIso;
  }

  // App ---------------------------------------------------------------------

  /** Read-only facts for the Settings screen. No secrets, no credentials. */
  async appInfo(): Promise<AppInfo> {
    return {
      dataDir: this.deps.files.root,
      engine: this.deps.repo.engine,
      engineReason: this.deps.engineReason ?? '',
      pack: this.deps.pack ? `${this.deps.pack.id}@${this.deps.pack.version}` : null,
      packRoles: this.deps.pack?.roles.length ?? 0,
    };
  }

  // Brands ------------------------------------------------------------------

  async listBrands(): Promise<Brand[]> {
    return this.deps.repo.listBrands();
  }

  async createBrand(name: string): Promise<Brand> {
    const cleanName = requireLabel(name, 'Brand name', LIMITS.name);
    const brand: Brand = { id: newId('brd'), name: cleanName, context: '', createdAt: this.clock() };
    this.deps.repo.insertBrand(brand);
    this.deps.files.ensureBrand(brand.id);
    return brand;
  }

  async updateBrand(id: string, context: string): Promise<Brand> {
    const brandId = requireId(id, 'brandId');
    const cleanContext = requireText(context, 'Brand context', LIMITS.context, { allowEmpty: true });
    return this.deps.repo.updateBrandContext(brandId, cleanContext);
  }

  // Works -------------------------------------------------------------------

  async listWorks(brandId: string): Promise<Work[]> {
    const id = requireId(brandId, 'brandId');
    this.deps.repo.getBrand(id);
    return this.deps.repo.listWorks(id).map((work) => this.syncFromDisk(work));
  }

  async createWork(brandId: string, title: string): Promise<Work> {
    const id = requireId(brandId, 'brandId');
    const cleanTitle = requireLabel(title, 'Work title', LIMITS.title);
    const brand = this.deps.repo.getBrand(id);
    const initialDocument = `# ${cleanTitle}\n\n`;
    const work: Work = { id: newId('wrk'), brandId: id, title: cleanTitle, brief: initialDocument, folder: null, updatedAt: this.clock() };
    this.deps.repo.insertWork(work);
    this.deps.repo.insertDocument({
      id: briefDocumentId(work.id),
      workId: work.id,
      kind: 'brief',
      title: cleanTitle,
      fileName: WORK_FILES.brief,
      status: 'draft',
      baseDocumentId: null,
      baseRevisionId: null,
      baseFingerprint: null,
      lastFingerprint: fingerprintOf(initialDocument),
      createdAt: work.updatedAt,
      updatedAt: work.updatedAt,
    });
    this.deps.files.ensureWork(id, work.id, initialDocument);
    this.refreshInstructions(brand, work);
    return work;
  }

  /** Saves the work's brief document. Kept for the existing UI/API surface; it delegates to saveDocument. */
  async saveBrief(workId: string, brief: string, baseFingerprint: string | null = null): Promise<SaveOutcome> {
    const id = requireId(workId, 'workId');
    this.deps.repo.getWork(id);
    return this.saveDocument(briefDocumentId(id), brief, baseFingerprint);
  }

  // Documents ---------------------------------------------------------------

  async listDocuments(workId: string): Promise<WorkDocument[]> {
    const id = requireId(workId, 'workId');
    const work = this.deps.repo.getWork(id);
    this.deps.files.ensureWork(work.brandId, work.id, work.brief);
    return this.deps.repo.listDocuments(id).map((record) => this.describeDocument(record));
  }

  async readDocument(documentId: string): Promise<DocumentContent> {
    return this.loadDocument(requireId(documentId, 'documentId'));
  }

  /** Cheap poll: the UI compares this fingerprint with the one it is editing. */
  async documentState(documentId: string): Promise<DocumentState> {
    const record = this.deps.repo.getDocument(requireId(documentId, 'documentId'));
    const work = this.deps.repo.getWork(record.workId);
    const disk = this.deps.files.readDocument(work.brandId, work.id, record.fileName);
    return { documentId: record.id, fingerprint: disk.fingerprint, modifiedAt: disk.modifiedAt, baseOutdated: this.isBaseOutdated(record) };
  }

  async createDocument(workId: string, kind: DocumentKind, title: string, baseDocumentId: string | null = null): Promise<DocumentContent> {
    const id = requireId(workId, 'workId');
    if (!DOCUMENT_KINDS.includes(kind)) throw new TypeError('Unknown document kind');
    const cleanTitle = requireLabel(title, 'Document title', LIMITS.title);
    const work = this.deps.repo.getWork(id);
    let base: DocumentRecord | null = null;
    if (baseDocumentId !== null) {
      base = this.deps.repo.getDocument(requireId(baseDocumentId, 'baseDocumentId'));
      if (base.workId !== work.id) throw new ValidationError('The base document belongs to another work');
    }
    const fileName = documentFileName(kind, this.deps.repo.usedFileNames(work.id));
    const now = this.clock();
    const content = renderDocumentTemplate(kind, cleanTitle, work.title, base ? base.title : null);
    // A derived document pins the exact base version it started from.
    const pinned = base ? this.pinBaseVersion(base) : null;
    const record: DocumentRecord = {
      id: newId('doc'),
      workId: work.id,
      kind,
      title: cleanTitle,
      fileName,
      status: 'draft',
      baseDocumentId: base ? base.id : null,
      baseRevisionId: pinned ? pinned.revisionId : null,
      baseFingerprint: pinned ? pinned.fingerprint : null,
      lastFingerprint: fingerprintOf(content),
      createdAt: now,
      updatedAt: now,
    };
    this.deps.files.ensureWork(work.brandId, work.id, work.brief);
    this.deps.files.writeDocument(work.brandId, work.id, content, fileName);
    this.deps.repo.insertDocument(record);
    return this.loadDocument(record.id);
  }

  /**
   * Never overwrites a change Latte has not seen. When the file on disk moved
   * away from the base the caller edited, the disk version is stored as an
   * immutable revision (source "external": an outside write does not identify
   * its author) and the caller gets both variants back to resolve explicitly.
   */
  async saveDocument(documentId: string, content: string, baseFingerprint: string | null = null): Promise<SaveOutcome> {
    const id = requireId(documentId, 'documentId');
    const clean = requireText(content, 'Document', LIMITS.document, { allowEmpty: true });
    if (baseFingerprint !== null && !FINGERPRINT.test(baseFingerprint)) throw new TypeError('Invalid fingerprint');
    const record = this.deps.repo.getDocument(id);
    const work = this.deps.repo.getWork(record.workId);
    this.deps.files.ensureWork(work.brandId, work.id, work.brief);
    const disk = this.deps.files.readDocument(work.brandId, work.id, record.fileName);
    const target = fingerprintOf(clean);
    const base = baseFingerprint ?? record.lastFingerprint ?? (record.fileName === WORK_FILES.brief ? fingerprintOf(work.brief) : null);
    const unseenChange = disk.modifiedAt !== null && base !== null && disk.fingerprint !== base && disk.fingerprint !== target;
    if (unseenChange) {
      const kept = this.storeRevision(work, record, disk.content, 'external');
      return { status: 'conflict', document: this.describeDocument(record), disk: this.contentFrom(record, disk), keptRevision: kept };
    }
    const now = this.clock();
    this.deps.files.writeDocument(work.brandId, work.id, clean, record.fileName);
    const updated = this.deps.repo.updateDocument(record.id, { lastFingerprint: target, updatedAt: now });
    const workRow = record.fileName === WORK_FILES.brief ? this.deps.repo.updateBrief(work.id, clean, now) : (this.deps.repo.touchWork(work.id, now), this.deps.repo.getWork(work.id));
    return { status: 'saved', document: this.describeDocument(updated), fingerprint: target, work: workRow };
  }

  async updateDocument(documentId: string, patch: { title?: string; status?: DocumentStatus }): Promise<WorkDocument> {
    const id = requireId(documentId, 'documentId');
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new TypeError('Invalid patch');
    const title = patch.title === undefined ? undefined : requireLabel(patch.title, 'Document title', LIMITS.title);
    if (patch.status !== undefined && !DOCUMENT_STATUSES.includes(patch.status)) throw new TypeError('Unknown document status');
    this.deps.repo.getDocument(id);
    return this.describeDocument(this.deps.repo.updateDocument(id, { title, status: patch.status, updatedAt: this.clock() }));
  }

  async listDocumentRevisions(documentId: string): Promise<Revision[]> {
    const record = this.deps.repo.getDocument(requireId(documentId, 'documentId'));
    return this.deps.repo.listDocumentRevisions(record.workId, record.id);
  }

  /** Versions always come from disk, so taking one never writes the editor over an external change. */
  async snapshotDocument(documentId: string): Promise<Revision> {
    const record = this.deps.repo.getDocument(requireId(documentId, 'documentId'));
    const work = this.deps.repo.getWork(record.workId);
    const disk = this.syncDocumentFromDisk(work, record);
    return this.storeRevision(this.deps.repo.getWork(record.workId), record, disk.content, 'human');
  }

  /** Stores the human's text as a version. The file is untouched: this is how a conflict is resolved without losing either side. */
  async keepDraftAsVersion(documentId: string, content: string): Promise<Revision> {
    const record = this.deps.repo.getDocument(requireId(documentId, 'documentId'));
    const clean = requireText(content, 'Document', LIMITS.document, { allowEmpty: true });
    return this.storeRevision(this.deps.repo.getWork(record.workId), record, clean, 'human');
  }

  async exportDocument(documentId: string): Promise<string | null> {
    const record = this.deps.repo.getDocument(requireId(documentId, 'documentId'));
    const work = this.deps.repo.getWork(record.workId);
    const disk = this.syncDocumentFromDisk(work, record);
    const target = await this.deps.chooseExportPath(`${slugify(record.title, record.kind)}.md`);
    if (!target) return null;
    writeFileAtomic(target, disk.content);
    return target;
  }

  /**
   * Markdown an agent (or anyone) left in the work folder that Latte does not
   * track yet. An agent cannot register a document by itself: the managed
   * instruction files are Latte's, and letting a runtime edit them would make
   * the list of deliverables unverifiable. So Latte looks for the files and
   * offers to adopt them.
   */
  async listUntrackedFiles(workId: string): Promise<UntrackedFile[]> {
    const id = requireId(workId, 'workId');
    const work = this.syncFromDisk(this.deps.repo.getWork(id));
    this.deps.files.ensureWork(work.brandId, work.id, work.brief);
    const directory = this.deps.files.workDir(work.brandId, work.id);
    const tracked = new Set(this.deps.repo.usedFileNames(work.id));
    const out: UntrackedFile[] = [];
    for (const name of scanFolder(directory).markdown) {
      if (tracked.has(name)) continue;
      // Latte's own README is not a deliverable; one the client already had is.
      if (name === WORK_FILES.readme && this.deps.files.readDocument(work.brandId, work.id, name).content.startsWith('# Latte work directory')) continue;
      const stat = this.deps.files.statDocument(work.brandId, work.id, name);
      out.push({ fileName: name, title: titleFromFileName(name), kind: kindOf(kindFromFileName(name)), bytes: stat.bytes, modifiedAt: stat.modifiedAt });
    }
    return out;
  }

  /** Adopts an existing file: from here it has versions, export and conflict checks. */
  async trackFile(workId: string, fileName: string): Promise<WorkDocument> {
    const id = requireId(workId, 'workId');
    const work = this.syncFromDisk(this.deps.repo.getWork(id));
    const candidates = await this.listUntrackedFiles(id);
    const candidate = candidates.find((c) => c.fileName === fileName);
    if (!candidate) throw new ValidationError('Ese archivo no está en la carpeta del trabajo o ya es un documento');
    const now = this.clock();
    const disk = this.deps.files.readDocument(work.brandId, work.id, candidate.fileName);
    const record: DocumentRecord = {
      id: newId('doc'),
      workId: work.id,
      kind: candidate.kind,
      title: candidate.title,
      fileName: candidate.fileName,
      status: 'draft',
      baseDocumentId: null,
      baseRevisionId: null,
      baseFingerprint: null,
      lastFingerprint: disk.fingerprint,
      createdAt: now,
      updatedAt: now,
    };
    this.deps.repo.insertDocument(record);
    this.refreshInstructions(this.deps.repo.getBrand(work.brandId), this.deps.repo.getWork(work.id));
    return this.describeDocument(record);
  }

  /**
   * Turns an answer that lives in a conversation into a document of the work.
   * A good answer is worth as much as a file, but only a file has versions,
   * export and conflict checking, so this is how one becomes the other.
   */
  async saveAsDocument(workId: string, kind: DocumentKind, title: string, content: string): Promise<WorkDocument> {
    const id = requireId(workId, 'workId');
    if (!DOCUMENT_KINDS.includes(kind)) throw new TypeError('Unknown document kind');
    const cleanTitle = requireLabel(title, 'Document title', LIMITS.title);
    const clean = requireText(content, 'Document', LIMITS.document);
    const work = this.syncFromDisk(this.deps.repo.getWork(id));
    const fileName = documentFileName(kind, this.deps.repo.usedFileNames(work.id));
    const now = this.clock();
    this.deps.files.ensureWork(work.brandId, work.id, work.brief);
    this.deps.files.writeDocument(work.brandId, work.id, clean, fileName);
    const record: DocumentRecord = {
      id: newId('doc'),
      workId: work.id,
      kind,
      title: cleanTitle,
      fileName,
      status: 'draft',
      baseDocumentId: null,
      baseRevisionId: null,
      baseFingerprint: null,
      lastFingerprint: fingerprintOf(clean),
      createdAt: now,
      updatedAt: now,
    };
    this.deps.repo.insertDocument(record);
    this.refreshInstructions(this.deps.repo.getBrand(work.brandId), this.deps.repo.getWork(work.id));
    return this.describeDocument(record);
  }

  /** After the human reviewed the change, the derived document points at the base's current version. */
  async acknowledgeBase(documentId: string): Promise<WorkDocument> {
    const record = this.deps.repo.getDocument(requireId(documentId, 'documentId'));
    if (!record.baseDocumentId) throw new ValidationError('This document has no base version');
    const base = this.deps.repo.getDocument(record.baseDocumentId);
    const pinned = this.pinBaseVersion(base);
    return this.describeDocument(this.deps.repo.updateDocument(record.id, { baseRevisionId: pinned.revisionId, baseFingerprint: pinned.fingerprint, updatedAt: this.clock() }));
  }

  /**
   * Points a work at a folder the person already works in.
   *
   * Nothing is copied and nothing is moved: that folder becomes the work. In
   * exchange Latte writes its managed context files and a versions folder
   * inside it, and any agent opened for this work gets it as its working
   * directory. Markdown at the top level is registered so it gets versions and
   * export like any other deliverable.
   */
  async useFolder(workId: string): Promise<FolderLinkResult | null> {
    const id = requireId(workId, 'workId');
    const work = this.deps.repo.getWork(id);
    if (!this.deps.chooseFolder) throw new UnavailableError('Elegir una carpeta requiere la aplicación de escritorio');
    const chosen = await this.deps.chooseFolder('Elegí la carpeta de este trabajo');
    if (!chosen) return null;

    const check = checkFolder(chosen, this.deps.files.root);
    if (!check.ok) throw new ValidationError(check.reason ?? 'No se puede usar esa carpeta');
    const folder = nodePath.resolve(chosen);
    // Two works pointing at the same folder would fight over the same files.
    const taken = this.deps.repo.listWorks(work.brandId).find((w) => w.id !== work.id && w.folder && nodePath.resolve(w.folder) === folder);
    if (taken) throw new ValidationError('Esa carpeta ya la usa el trabajo "' + taken.title + '"');

    const scan = scanFolder(folder);
    this.deps.repo.setWorkFolder(work.id, folder, this.clock());
    this.deps.files.linkWork(work.id, folder);

    // From here on, every path of this work resolves inside the chosen folder.
    const brand = this.deps.repo.getBrand(work.brandId);
    this.deps.files.ensureWork(brand.id, work.id, work.brief);
    const now = this.clock();
    const documents: WorkDocument[] = [];
    const used = new Set(this.deps.repo.usedFileNames(work.id));
    for (const name of scan.markdown) {
      if (used.has(name)) continue;
      const disk = this.deps.files.readDocument(brand.id, work.id, name);
      const record: DocumentRecord = {
        id: newId('doc'),
        workId: work.id,
        kind: kindFromFileName(name),
        title: titleFromFileName(name),
        fileName: name,
        status: 'draft',
        baseDocumentId: null,
        baseRevisionId: null,
        baseFingerprint: null,
        lastFingerprint: disk.fingerprint,
        createdAt: now,
        updatedAt: now,
      };
      this.deps.repo.insertDocument(record);
      used.add(name);
      documents.push(this.describeDocument(record));
    }
    const synced = this.syncFromDisk(this.deps.repo.getWork(work.id));
    this.refreshInstructions(brand, synced);
    return {
      work: synced,
      folder,
      documents,
      otherFiles: scan.otherFiles.slice(0, 100),
      subfolders: scan.subfolders.slice(0, 100),
      managedFiles: [WORK_FILES.claude, WORK_FILES.agents, WORK_FILES.metaDir + '/', WORK_FILES.readme],
    };
  }

  // Revisions (immutable snapshots) ----------------------------------------

  async listRevisions(workId: string): Promise<Revision[]> {
    const id = requireId(workId, 'workId');
    this.deps.repo.getWork(id);
    return this.deps.repo.listRevisions(id);
  }

  /** Version of the work's brief document (kept for the existing API surface). */
  async snapshot(workId: string): Promise<Revision> {
    const id = requireId(workId, 'workId');
    this.deps.repo.getWork(id);
    return this.snapshotDocument(briefDocumentId(id));
  }

  // Decisions ---------------------------------------------------------------

  async listDecisions(workId: string): Promise<Decision[]> {
    const id = requireId(workId, 'workId');
    this.deps.repo.getWork(id);
    return this.deps.repo.listDecisions(id);
  }

  async addDecision(workId: string, text: string): Promise<Decision> {
    const cleanText = requireText(text, 'Decision', LIMITS.decision).trim();
    const work = this.deps.repo.getWork(requireId(workId, 'workId'));
    const decision: Decision = { id: newId('dec'), workId: work.id, text: cleanText, createdAt: this.clock() };
    this.deps.repo.insertDecision(decision);
    this.deps.repo.touchWork(work.id, decision.createdAt);
    return decision;
  }

  // Agents ------------------------------------------------------------------

  async runtimeStatus(): Promise<RuntimeStatus[]> {
    return this.deps.detector.status();
  }

  async startAgent(workId: string, provider: Provider): Promise<AgentSession> {
    assertProvider(provider);
    const work = this.syncFromDisk(this.deps.repo.getWork(requireId(workId, 'workId')));
    const brand = this.deps.repo.getBrand(work.brandId);
    const runtime = await this.deps.detector.resolve(provider);
    if (!runtime) throw new UnavailableError(`${provider} is not installed or not on PATH`);
    this.refreshInstructions(brand, work);
    return this.deps.terminal.start({
      workId: work.id,
      brandId: brand.id,
      provider,
      executable: runtime.executable,
      cwd: this.deps.files.workDir(work.brandId, work.id),
      extraEnv: { ENGRAM_PROJECT: memoryProjectFor(brand.id) },
    });
  }

  async writeAgent(sessionId: string, data: string): Promise<void> {
    const id = requireId(sessionId, 'sessionId');
    if (typeof data !== 'string') throw new TypeError('Terminal input must be a string');
    if (data.length > LIMITS.terminalChunk) throw new RangeError('Terminal input chunk too large');
    this.deps.terminal.write(id, data);
  }

  async resizeAgent(sessionId: string, cols: number, rows: number): Promise<void> {
    const id = requireId(sessionId, 'sessionId');
    this.deps.terminal.resize(id, requireInt(cols, 'cols', 1, 1000), requireInt(rows, 'rows', 1, 1000));
  }

  async stopAgent(sessionId: string): Promise<void> {
    this.deps.terminal.stop(requireId(sessionId, 'sessionId'));
  }

  // Structured chat (OpenCode) -----------------------------------------------

  async chatStatus(): Promise<ChatRuntimeStatus> {
    return this.deps.hub.status();
  }

  async startChat(workId: string, model: string | null = null, runtime: ChatRuntime | null = null, accountId: string | null = null): Promise<ChatSession> {
    const options = validateMemberOptions({ model, runtime, accountId });
    return this.deps.hub.start({ ...this.memberContext(workId), ...options });
  }

  // Team (roles per work) ---------------------------------------------------------

  async listRoles(): Promise<AgentRole[]> {
    return this.deps.hub.listRoles();
  }

  async listTeam(workId: string): Promise<TeamMember[]> {
    const id = requireId(workId, 'workId');
    this.deps.repo.getWork(id);
    return this.deps.hub.listTeam(id);
  }

  async addTeamMember(workId: string, roleId: string, options: TeamMemberOptions | null = null): Promise<ChatSession> {
    if (!RoleCatalog.isValidId(roleId)) throw new TypeError('Invalid role id');
    const overrides = validateMemberOptions(options ?? {});
    return this.deps.hub.addMember({ ...this.memberContext(workId), roleId, ...overrides });
  }

  async openTeamMember(memberId: string): Promise<ChatSession> {
    const member = this.deps.hub.getMember(requireId(memberId, 'memberId'));
    return this.deps.hub.openMember(member.id, this.memberContext(member.workId));
  }

  async pauseTeamMember(memberId: string): Promise<void> {
    this.deps.hub.pauseMember(requireId(memberId, 'memberId'));
  }

  async finishTeamMember(memberId: string): Promise<void> {
    this.deps.hub.finishMember(requireId(memberId, 'memberId'));
  }

  async removeTeamMember(memberId: string): Promise<void> {
    this.deps.hub.removeMember(requireId(memberId, 'memberId'));
  }

  /**
   * Everything a member's runtime needs to start inside the work directory.
   *
   * CLAUDE.md / AGENTS.md are shared by the whole team, so they are rewritten
   * only when no member of this work is running: a live session never sees its
   * context change underneath. This is a real guarantee about the managed
   * files, not about the work directory, which any process can still write.
   */
  private memberContext(workId: string): MemberContext {
    const work = this.syncFromDisk(this.deps.repo.getWork(requireId(workId, 'workId')));
    const brand = this.deps.repo.getBrand(work.brandId);
    if (this.deps.hub.liveMemberCount(work.id) === 0) this.refreshInstructions(brand, work);
    return {
      workId: work.id,
      brandId: brand.id,
      directory: this.deps.files.workDir(work.brandId, work.id),
      title: `${brand.name} · ${work.title}`,
      extraEnv: { ENGRAM_PROJECT: memoryProjectFor(brand.id) },
      trustedFolder: this.folderTrust(work.id),
    };
  }

  private folderTrust(workId: string): boolean {
    return this.deps.repo.getMeta(FOLDER_TRUST_KEY + workId) === '1';
  }

  /**
   * Whether this work's team may read and write inside its own folder without
   * asking every time. Off by default: the human grants it, per work, and it
   * covers that folder only. Everything else keeps asking.
   */
  async getFolderTrust(workId: string): Promise<boolean> {
    const id = requireId(workId, 'workId');
    this.deps.repo.getWork(id);
    return this.folderTrust(id);
  }

  async setFolderTrust(workId: string, trusted: boolean): Promise<boolean> {
    const id = requireId(workId, 'workId');
    this.deps.repo.getWork(id);
    if (typeof trusted !== 'boolean') throw new TypeError('Invalid folder trust value');
    this.deps.repo.setMeta(FOLDER_TRUST_KEY + id, trusted ? '1' : '0');
    return trusted;
  }

  async listChatMessages(chatId: string): Promise<ChatMessage[]> {
    return this.deps.hub.listMessages(requireId(chatId, 'chatId'));
  }

  async sendChat(chatId: string, text: string): Promise<void> {
    const clean = requireText(text, 'Message', LIMITS.chatMessage).trim();
    await this.deps.hub.send(requireId(chatId, 'chatId'), clean);
  }

  async abortChat(chatId: string): Promise<void> {
    await this.deps.hub.abort(requireId(chatId, 'chatId'));
  }

  async stopChat(chatId: string): Promise<void> {
    this.deps.hub.stop(requireId(chatId, 'chatId'));
  }

  async replyPermission(chatId: string, requestId: string, reply: PermissionReply): Promise<void> {
    if (reply !== 'once' && reply !== 'always' && reply !== 'reject') throw new TypeError('Invalid permission reply');
    await this.deps.hub.replyPermission(requireId(chatId, 'chatId'), requireRequestId(requestId), reply);
  }

  // Primary agent + subscription runtimes ---------------------------------------

  async getPrimaryAgent(): Promise<PrimaryAgent | null> {
    return this.deps.hub.getPrimary();
  }

  async setPrimaryAgent(choice: { runtime: ChatRuntime; model: string | null; accountId: string | null }): Promise<PrimaryAgent> {
    if (typeof choice !== 'object' || choice === null) throw new TypeError('Invalid choice');
    if (!isChatRuntime(choice.runtime)) throw new TypeError('Unknown runtime');
    const model = choice.model === null || choice.model === undefined ? null : choice.model;
    if (model !== null && (typeof model !== 'string' || model.length === 0 || model.length > 200 || /[\s\0]/.test(model))) throw new TypeError('Invalid model id');
    const accountId = choice.accountId === null || choice.accountId === undefined ? null : choice.accountId;
    if (accountId !== null && !AccountStore.isValidId(accountId)) throw new TypeError('Invalid account id');
    return this.deps.hub.setPrimary({ runtime: choice.runtime, model, accountId });
  }

  async listAgentRuntimes(): Promise<AgentRuntimeInfo[]> {
    return this.deps.hub.listAgentRuntimes();
  }

  // MCP: shown and operated through each runtime's own CLI ---------------------

  /**
   * Without a runtime, all three. With one, only that one, so the screen can
   * fill in as each answers: Claude Code health-checks every server and takes
   * far longer than the other two, and waiting for it hid their results.
   */
  async listMcpServers(runtime: ChatRuntime | null = null): Promise<McpRuntimeTools[]> {
    if (!this.deps.mcp) return [];
    if (runtime === null) return this.deps.mcp.list();
    if (runtime !== 'claude' && runtime !== 'codex' && runtime !== 'opencode') throw new TypeError('Unknown runtime');
    return [await this.deps.mcp.listOne(runtime)];
  }

  async addMcpServer(runtime: 'claude' | 'codex', input: McpServerInput): Promise<void> {
    if (!isAccountRuntime(runtime)) throw new TypeError('Unknown runtime');
    if (!this.deps.mcp) throw new UnavailableError('MCP requiere la aplicación de escritorio');
    if (typeof input !== 'object' || input === null) throw new TypeError('Invalid input');
    const transport = input.transport === 'http' ? 'http' : 'stdio';
    const name = requireLabel(input.name, 'Server name', 64);
    const command = transport === 'stdio' ? requireLabel(input.command, 'Command', 400) : '';
    const url = transport === 'http' ? requireLabel(input.url, 'URL', 500) : '';
    if (transport === 'http' && !/^https?:\/\//.test(url)) throw new TypeError('La URL tiene que empezar con http:// o https://');
    const args = Array.isArray(input.args) ? input.args.slice(0, 30).map((a) => requireText(String(a), 'Argument', 300)) : [];
    const envPairs = Array.isArray(input.env) ? input.env.slice(0, 20).map((a) => requireText(String(a), 'Variable', 400)) : [];
    await this.deps.mcp.add(runtime, { name, transport, command, args, url, env: envPairs });
  }

  async removeMcpServer(runtime: 'claude' | 'codex', name: string): Promise<void> {
    if (!isAccountRuntime(runtime)) throw new TypeError('Unknown runtime');
    if (!this.deps.mcp) throw new UnavailableError('MCP requiere la aplicación de escritorio');
    await this.deps.mcp.remove(runtime, requireLabel(name, 'Server name', 64));
  }

  async addAgentAccount(runtime: 'claude' | 'codex', label: string): Promise<AgentAccount> {
    if (!isAccountRuntime(runtime)) throw new TypeError('Unknown runtime');
    return this.deps.hub.addAccount(runtime, requireLabel(label, 'Account label', 80));
  }

  async removeAgentAccount(runtime: 'claude' | 'codex', accountId: string): Promise<void> {
    if (!isAccountRuntime(runtime)) throw new TypeError('Unknown runtime');
    if (!AccountStore.isValidId(accountId)) throw new TypeError('Invalid account id');
    this.deps.hub.removeAccount(runtime, accountId);
  }

  async startAccountLogin(runtime: 'claude' | 'codex', accountId: string): Promise<AccountLoginStart> {
    if (!isAccountRuntime(runtime)) throw new TypeError('Unknown runtime');
    if (!AccountStore.isValidId(accountId)) throw new TypeError('Invalid account id');
    const start = await this.deps.hub.startLogin(runtime, accountId);
    if (start.mode === 'browser' && /^https?:\/\//.test(start.url)) await this.deps.openExternal?.(start.url);
    return start;
  }

  async logoutAccount(runtime: 'claude' | 'codex', accountId: string): Promise<void> {
    if (!isAccountRuntime(runtime)) throw new TypeError('Unknown runtime');
    if (!AccountStore.isValidId(accountId)) throw new TypeError('Invalid account id');
    await this.deps.hub.logout(runtime, accountId);
  }

  async replyQuestion(chatId: string, requestId: string, answers: string[][] | null): Promise<void> {
    if (answers !== null) {
      if (!Array.isArray(answers) || answers.length > 20) throw new TypeError('Invalid answers');
      for (const answer of answers) {
        if (!Array.isArray(answer) || answer.length > 20 || answer.some((a) => typeof a !== 'string' || a.length > 2_000)) throw new TypeError('Invalid answers');
      }
    }
    await this.deps.hub.replyQuestion(requireId(chatId, 'chatId'), requireRequestId(requestId), answers);
  }

  // Providers (runtime credential store; Latte never persists secrets) --------

  async listProviders(): Promise<ProviderInfo[]> {
    return this.deps.chat.listProviders();
  }

  async connectProviderKey(providerId: string, key: string): Promise<void> {
    const id = requireProviderId(providerId);
    if (typeof key !== 'string') throw new TypeError('API key must be a string');
    const clean = key.trim();
    if (clean.length === 0 || clean.length > 4_096 || /[\r\n\0]/.test(clean)) throw new TypeError('API key looks invalid');
    await this.deps.chat.connectApiKey(id, clean);
  }

  async disconnectProvider(providerId: string): Promise<void> {
    await this.deps.chat.disconnectProvider(requireProviderId(providerId));
  }

  async startProviderOAuth(providerId: string, methodIndex: number, inputs: Record<string, string>): Promise<ProviderOAuthStart> {
    const id = requireProviderId(providerId);
    const method = requireInt(methodIndex, 'methodIndex', 0, 20);
    const cleanInputs: Record<string, string> = {};
    if (inputs !== undefined && inputs !== null) {
      if (typeof inputs !== 'object' || Array.isArray(inputs)) throw new TypeError('Invalid inputs');
      for (const [k, v] of Object.entries(inputs)) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(k) || typeof v !== 'string' || v.length > 2_048) throw new TypeError('Invalid inputs');
        cleanInputs[k] = v;
      }
    }
    const started = await this.deps.chat.startOAuth(id, method, cleanInputs);
    if (/^https?:\/\//.test(started.url)) await this.deps.openExternal?.(started.url);
    return started;
  }

  async completeProviderOAuth(providerId: string, methodIndex: number, code: string | null): Promise<void> {
    const id = requireProviderId(providerId);
    const method = requireInt(methodIndex, 'methodIndex', 0, 20);
    if (code !== null && (typeof code !== 'string' || code.length === 0 || code.length > 2_048 || /[\r\n\0]/.test(code))) throw new TypeError('Invalid code');
    await this.deps.chat.completeOAuth(id, method, code === null ? null : code.trim());
  }

  // Memory ------------------------------------------------------------------

  async readMemory(brandId: string): Promise<MemoryResult> {
    const brand = this.deps.repo.getBrand(requireId(brandId, 'brandId'));
    return this.deps.engram.read(memoryProjectFor(brand.id));
  }

  async saveMemory(brandId: string, text: string): Promise<MemoryResult> {
    const clean = requireText(text, 'Memory', LIMITS.memory).trim();
    const brand = this.deps.repo.getBrand(requireId(brandId, 'brandId'));
    const firstLine = clean.split(/\r?\n/)[0].slice(0, 80);
    const title = `${brand.name}: ${firstLine}`;
    return this.deps.engram.save(memoryProjectFor(brand.id), title, clean);
  }

  // Export ------------------------------------------------------------------

  async exportWork(workId: string): Promise<string | null> {
    // Exports exactly what the user sees. An intentionally blank document
    // exports as blank; we never substitute older content.
    const work = this.syncFromDisk(this.deps.repo.getWork(requireId(workId, 'workId')));
    const content = work.brief;
    const target = await this.deps.chooseExportPath(`${slugify(work.title, 'deliverable')}.md`);
    if (!target) return null;
    writeFileAtomic(target, content);
    return target;
  }

  // Lifecycle ---------------------------------------------------------------

  shutdown(): void {
    this.deps.hub.shutdown();
    this.deps.terminal.stopAll();
    this.deps.repo.close();
  }

  // Internals ---------------------------------------------------------------

  /**
   * deliverable.md wins over the database copy. If an agent (or the human, in
   * an editor) changed the file, the database is updated before anyone reads.
   */
  private describeDocument(record: DocumentRecord): WorkDocument {
    return {
      id: record.id,
      workId: record.workId,
      kind: (DOCUMENT_KINDS as string[]).includes(record.kind) ? (record.kind as DocumentKind) : 'note',
      title: record.title,
      fileName: record.fileName,
      status: (DOCUMENT_STATUSES as string[]).includes(record.status) ? (record.status as DocumentStatus) : 'draft',
      baseDocumentId: record.baseDocumentId,
      baseRevisionId: record.baseRevisionId,
      baseFingerprint: record.baseFingerprint,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private contentFrom(record: DocumentRecord, disk: DocumentOnDisk): DocumentContent {
    return { document: this.describeDocument(record), content: disk.content, fingerprint: disk.fingerprint, modifiedAt: disk.modifiedAt, baseOutdated: this.isBaseOutdated(record) };
  }

  private loadDocument(documentId: string): DocumentContent {
    const record = this.deps.repo.getDocument(documentId);
    const work = this.deps.repo.getWork(record.workId);
    const disk = this.syncDocumentFromDisk(work, record);
    return this.contentFrom(this.deps.repo.getDocument(documentId), disk);
  }

  /**
   * The file is the authority. Reading refreshes what Latte mirrors in the
   * database (the brief column, for the brief document) but never rewrites the
   * file, so an external edit survives a read.
   */
  private syncDocumentFromDisk(work: Work, record: DocumentRecord): DocumentOnDisk {
    this.deps.files.ensureWork(work.brandId, work.id, work.brief);
    if (!this.deps.files.documentExists(work.brandId, work.id, record.fileName)) {
      // A tracked file someone deleted outside Latte: recreate it empty rather than lying about its content.
      this.deps.files.writeDocument(work.brandId, work.id, '', record.fileName);
    }
    const disk = this.deps.files.readDocument(work.brandId, work.id, record.fileName);
    if (record.fileName === WORK_FILES.brief && disk.content !== work.brief) {
      const updatedAt = disk.modifiedAt && disk.modifiedAt > work.updatedAt ? disk.modifiedAt : this.clock();
      this.deps.repo.updateBrief(work.id, disk.content, updatedAt);
    }
    return disk;
  }

  private storeRevision(work: Work, record: DocumentRecord, content: string, source: RevisionSource): Revision {
    const revision: Revision = { id: newId('rev'), workId: work.id, documentId: record.id, source, content, createdAt: this.clock() };
    return this.deps.repo.transaction(() => {
      this.deps.repo.insertRevision(revision);
      this.deps.files.writeSnapshot(work.brandId, work.id, revision.id, revision.createdAt, revision.content);
      this.deps.repo.touchWork(work.id, revision.createdAt);
      return revision;
    });
  }

  /**
   * Pins the current content of a base document as an immutable revision, so a
   * derived document can point at an exact version instead of a moving file.
   */
  private pinBaseVersion(base: DocumentRecord): { revisionId: string; fingerprint: string } {
    const work = this.deps.repo.getWork(base.workId);
    const disk = this.syncDocumentFromDisk(work, base);
    const existing = this.deps.repo.listDocumentRevisions(base.workId, base.id).find((r) => fingerprintOf(r.content) === disk.fingerprint);
    const revision = existing ?? this.storeRevision(work, base, disk.content, 'latte');
    return { revisionId: revision.id, fingerprint: disk.fingerprint };
  }

  /** True when the base document's file no longer matches the version this one declared. */
  private isBaseOutdated(record: DocumentRecord): boolean {
    if (!record.baseDocumentId || !record.baseFingerprint) return false;
    const base = this.deps.repo.findDocument(record.baseDocumentId);
    if (!base) return false;
    const work = this.deps.repo.getWork(base.workId);
    return this.deps.files.readDocument(work.brandId, work.id, base.fileName).fingerprint !== record.baseFingerprint;
  }

  private syncFromDisk(work: Work): Work {
    this.deps.files.ensureWork(work.brandId, work.id, work.brief);
    const onDisk = this.deps.files.readDocument(work.brandId, work.id);
    if (onDisk.modifiedAt === null || onDisk.content === work.brief) return work;
    const updatedAt = onDisk.modifiedAt > work.updatedAt ? onDisk.modifiedAt : this.clock();
    return this.deps.repo.updateBrief(work.id, onDisk.content, updatedAt);
  }

  private refreshInstructions(brand: Brand, work: Work): void {
    const decisions = this.deps.repo.listDecisions(work.id);
    const records = this.deps.repo.listDocuments(work.id);
    const byId = new Map(records.map((r) => [r.id, r]));
    const documents = records.map((r) => ({
      kind: r.kind,
      title: r.title,
      fileName: r.fileName,
      status: r.status,
      baseFileName: r.baseDocumentId ? byId.get(r.baseDocumentId)?.fileName ?? null : null,
    }));
    this.deps.files.ensureWork(brand.id, work.id, work.brief);
    this.deps.files.writeInstructions(brand.id, work.id, renderInstructions({ brand, work, decisions, documents, pack: this.deps.pack ?? null, memoryProject: memoryProjectFor(brand.id) }));
  }
}
