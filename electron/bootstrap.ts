import path from 'node:path';
import type { AgentEvent, ChatEvent } from '../shared/contracts';
import { AccountStore } from './agents/accounts';
import { ClaudeChatAdapter } from './agents/claude/claudeAdapter';
import { CodexChatAdapter } from './agents/codex/codexAdapter';
import { AgentHub } from './agents/hub';
import { McpCatalog } from './agents/mcp';
import { RoleCatalog } from './agents/roles';
import { TranscriptStore } from './agents/transcripts';
import { LattePaths } from './core/paths';
import { EngramClient } from './memory/engram';
import { ChatManager } from './opencode/chatManager';
import type { OpenCodeEndpoint } from './opencode/server';
import { execFileRunner, type CommandRunner } from './runtime/commandRunner';
import { RuntimeDetector } from './runtime/detect';
import { loadPty, type PtyLoadResult } from './runtime/ptyLoader';
import { TerminalManager } from './runtime/terminalManager';
import { LatteService } from './services/latteService';
import { seedDemoIfEmpty } from './services/seed';
import { openDriver, type DriverPreference } from './storage/openDriver';
import { LatteRepository } from './storage/repository';
import { loadInstructionPack } from './workspace/packs';
import { WorkspaceFiles } from './workspace/workspace';

export interface BackendOptions {
  dataDir: string;
  emit: (event: AgentEvent) => void;
  /** Structured chat events; optional so older harnesses keep working. */
  emitChat?: (event: ChatEvent) => void;
  chooseExportPath: (suggestedFileName: string) => Promise<string | null>;
  /** Opens a native folder picker (desktop only). */
  chooseFolder?: (title: string) => Promise<string | null>;
  seedDemo?: boolean;
  driver?: DriverPreference;
  runner?: CommandRunner;
  loadPty?: () => PtyLoadResult;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Directory holding instruction packs (default: <repo>/packs). */
  packsDir?: string;
  /** Tests: reuse a running (fake) OpenCode endpoint instead of spawning the CLI. */
  chatEndpoint?: OpenCodeEndpoint;
  /** Opens an http(s) URL in the system browser (OAuth logins). */
  openExternal?: (url: string) => Promise<void>;
  log?: (line: string) => void;
}

export interface Backend {
  service: LatteService;
  repo: LatteRepository;
  files: WorkspaceFiles;
  terminal: TerminalManager;
  detector: RuntimeDetector;
  chat: ChatManager;
  hub: AgentHub;
  accounts: AccountStore;
  info: { dataDir: string; dbFile: string; engine: string; engineReason: string; seeded: boolean; pack: string | null };
}

/** Wires every backend piece together. Used by main.ts and by the tests. */
export async function createBackend(options: BackendOptions): Promise<Backend> {
  const paths = new LattePaths(options.dataDir);
  const { driver, reason } = await openDriver(paths.dbFile, options.driver ?? 'auto');
  const repo = new LatteRepository(driver);
  repo.migrate();

  const files = new WorkspaceFiles(paths);
  // Works linked to a user folder resolve there from the first read on.
  for (const linked of repo.linkedWorks()) files.linkWork(linked.id, linked.dir);
  const runner = options.runner ?? execFileRunner;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  const terminal = new TerminalManager({ loadPty: options.loadPty ?? loadPty, emit: options.emit, env, platform });
  const detector = new RuntimeDetector({ runner, terminalAvailability: () => terminal.availability(), platform, env });

  const chat = new ChatManager({
    resolveExecutable: async () => {
      const found = await detector.resolve('opencode');
      return found ? { executable: found.executable, version: found.version } : null;
    },
    serverCwd: paths.root,
    emit: options.emitChat ?? (() => {}),
    env,
    platform,
    endpoint: options.chatEndpoint,
    log: options.log,
  });

  const accounts = new AccountStore({
    root: path.join(paths.root, 'accounts'),
    runner,
    resolveExecutable: async (runtime) => (await detector.resolve(runtime))?.executable ?? null,
    env,
  });
  const transcripts = new TranscriptStore(path.join(paths.root, 'transcripts'));
  const claude = new ClaudeChatAdapter({
    resolveExecutable: async () => {
      const found = await detector.resolve('claude');
      return found ? { executable: found.executable, version: found.version } : null;
    },
    emit: options.emitChat ?? (() => {}),
    accountEnv: (accountId) => accounts.envFor('claude', accountId),
    onSessionId: (chatId, sessionId) => hub.rememberSession(chatId, sessionId),
    promptDir: path.join(paths.root, 'prompts'),
    transcripts,
    env,
    platform,
    log: options.log,
  });
  const codex = new CodexChatAdapter({
    resolveExecutable: async () => {
      const found = await detector.resolve('codex');
      return found ? { executable: found.executable, version: found.version } : null;
    },
    emit: options.emitChat ?? (() => {}),
    accountEnv: (accountId) => accounts.envFor('codex', accountId),
    serverCwd: paths.root,
    env,
    platform,
    log: options.log,
  });
  const packsDir = options.packsDir ?? path.resolve(__dirname, '..', 'packs');
  const pack = loadInstructionPack(packsDir, 'marketing-core');
  const roles = new RoleCatalog(pack);
  const hub: AgentHub = new AgentHub({ opencode: chat, claude, codex, accounts, repo, detector, terminal, runner, roles, transcripts, promptDir: path.join(paths.root, 'prompts'), env });

  const mcp = new McpCatalog({ runner, detector, accountEnv: (runtime, accountId) => accounts.envFor(runtime, accountId), env });

  const engram = new EngramClient({
    runner,
    locate: () => locateExecutable(runner, 'engram', platform, env),
  });

  const service = new LatteService({
    repo,
    files,
    detector,
    terminal,
    chat,
    hub,
    engram,
    mcp,
    pack,
    engineReason: reason,
    chooseExportPath: options.chooseExportPath,
    chooseFolder: options.chooseFolder,
    openExternal: options.openExternal,
  });

  const seeded = options.seedDemo === false ? false : seedDemoIfEmpty(repo, files, pack);

  return {
    service,
    repo,
    files,
    terminal,
    detector,
    chat,
    hub,
    accounts,
    info: { dataDir: paths.root, dbFile: paths.dbFile, engine: driver.kind, engineReason: reason, seeded, pack: pack ? `${pack.id}@${pack.version}` : null },
  };
}

async function locateExecutable(runner: CommandRunner, name: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<string | null> {
  const result = await runner(platform === 'win32' ? 'where.exe' : 'which', [name], { timeoutMs: 4_000, env });
  if (result.error || result.timedOut || result.code !== 0) return null;
  const candidate = result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && path.isAbsolute(l));
  return candidate ?? null;
}
