import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AgentAccount } from '../../shared/contracts';
import { writeFileAtomic, readTextIfExists } from '../core/atomicFile';
import { NotFoundError, ValidationError } from '../core/errors';
import { safeJoin } from '../core/paths';
import type { CommandRunner } from '../runtime/commandRunner';
import { scrubEnv } from '../runtime/terminalManager';

export type AccountRuntime = 'claude' | 'codex';

export const SYSTEM_ACCOUNT_ID = 'system';
const ACCOUNT_ID = /^acc_[a-f0-9]{16}$/;
/** The aliases `claude --model` documents. Each one points at the latest model of its tier. */
const CLAUDE_MODEL_ALIASES = ['fable', 'opus', 'sonnet'] as const;

interface AccountRecord { id: string; label: string; createdAt: string }

export interface AccountStoreDeps {
  /** <dataDir>/accounts */
  root: string;
  runner: CommandRunner;
  resolveExecutable: (runtime: AccountRuntime) => Promise<string | null>;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/** Environment variable each CLI reads to relocate its profile (auth + settings). */
export const PROFILE_ENV: Record<AccountRuntime, string> = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };

/**
 * Orca-style account management: every Latte-managed account is a directory
 * the CLI treats as its home (CLAUDE_CONFIG_DIR / CODEX_HOME). The CLI does
 * its own OAuth into that directory; Latte only lists, labels and probes.
 * The "system" pseudo-account points at the user's regular CLI profile.
 */
export class AccountStore {
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  constructor(private readonly deps: AccountStoreDeps) {
    this.env = deps.env ?? process.env;
    this.timeoutMs = deps.timeoutMs ?? 12_000;
  }

  static isValidId(value: unknown): value is string {
    return value === SYSTEM_ACCOUNT_ID || (typeof value === 'string' && ACCOUNT_ID.test(value));
  }

  dir(runtime: AccountRuntime, accountId: string): string {
    if (accountId === SYSTEM_ACCOUNT_ID) throw new ValidationError('The system profile has no managed directory');
    if (!ACCOUNT_ID.test(accountId)) throw new ValidationError('Invalid account id');
    return safeJoin(this.deps.root, runtime, accountId);
  }

  /** Environment overlay that points the CLI at the account's profile (empty for the system profile). */
  envFor(runtime: AccountRuntime, accountId: string | null): Record<string, string> {
    if (!accountId || accountId === SYSTEM_ACCOUNT_ID) return {};
    return { [PROFILE_ENV[runtime]]: this.dir(runtime, accountId) };
  }

  list(runtime: AccountRuntime): AccountRecord[] {
    const dir = safeJoin(this.deps.root, runtime);
    if (!fs.existsSync(dir)) return [];
    const records: AccountRecord[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ACCOUNT_ID.test(entry.name)) continue;
      const raw = readTextIfExists(path.join(dir, entry.name, 'latte-account.json'));
      let label = entry.name;
      let createdAt = '';
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<AccountRecord>;
          if (typeof parsed.label === 'string') label = parsed.label;
          if (typeof parsed.createdAt === 'string') createdAt = parsed.createdAt;
        } catch { /* keep defaults */ }
      }
      records.push({ id: entry.name, label, createdAt });
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  create(runtime: AccountRuntime, label: string): AccountRecord {
    const clean = label.trim().replace(/\s+/g, ' ');
    if (clean.length === 0 || clean.length > 80) throw new ValidationError('Account label must be 1-80 characters');
    const record: AccountRecord = { id: `acc_${randomBytes(8).toString('hex')}`, label: clean, createdAt: new Date().toISOString() };
    const dir = this.dir(runtime, record.id);
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomic(path.join(dir, 'latte-account.json'), JSON.stringify(record, null, 2));
    return record;
  }

  remove(runtime: AccountRuntime, accountId: string): void {
    const dir = this.dir(runtime, accountId);
    if (!fs.existsSync(dir)) throw new NotFoundError('Account', accountId);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  async describe(runtime: AccountRuntime): Promise<AgentAccount[]> {
    const executable = await this.deps.resolveExecutable(runtime);
    const managed = this.list(runtime);
    const entries: Array<{ id: string; label: string; system: boolean }> = [
      { id: SYSTEM_ACCOUNT_ID, label: runtime === 'claude' ? 'Mi sesión de Claude Code' : 'Mi sesión de Codex', system: true },
      ...managed.map((m) => ({ id: m.id, label: m.label, system: false })),
    ];
    const results: AgentAccount[] = [];
    for (const entry of entries) {
      const models = this.suggestedModels(runtime, entry.id);
      if (!executable) {
        results.push({ runtime, ...entry, loggedIn: false, detail: `${runtime === 'claude' ? 'Claude Code' : 'Codex'} no está instalado`, models });
        continue;
      }
      const status = await this.status(runtime, executable, entry.id);
      results.push({ runtime, ...entry, ...status, models });
    }
    return results;
  }

  /**
   * What to offer under the model field. Not a catalog: Latte cannot enumerate
   * what a subscription CLI accepts, so it suggests only what it can state as
   * fact — the aliases Claude Code's own `--model` help documents (an alias
   * always points at the latest model of that tier, so it does not go stale),
   * and the model this Codex profile already has configured.
   */
  suggestedModels(runtime: AccountRuntime, accountId: string): string[] {
    if (runtime === 'claude') return [...CLAUDE_MODEL_ALIASES];
    const configured = this.codexConfiguredModel(accountId);
    return configured ? [configured] : [];
  }

  private codexConfiguredModel(accountId: string): string | null {
    const home = accountId === SYSTEM_ACCOUNT_ID
      ? (this.env.CODEX_HOME ?? (this.env.USERPROFILE || this.env.HOME ? path.join((this.env.USERPROFILE ?? this.env.HOME) as string, '.codex') : null))
      : this.dir('codex', accountId);
    if (!home) return null;
    const config = readTextIfExists(path.join(home, 'config.toml'));
    if (!config) return null;
    // Top-level `model = "..."` only: a value under a [profile] table belongs
    // to that profile, and Latte does not pass one.
    for (const line of config.split(/\r?\n/)) {
      const text = line.trim();
      if (text.startsWith('[')) break;
      const match = /^model\s*=\s*["']([^"']{1,200})["']$/.exec(text);
      if (match) return match[1];
    }
    return null;
  }

  async status(runtime: AccountRuntime, executable: string, accountId: string): Promise<{ loggedIn: boolean; detail: string }> {
    const env = { ...scrubEnv(this.env), ...this.envFor(runtime, accountId) };
    if (runtime === 'claude') {
      const result = await this.deps.runner(executable, ['auth', 'status', '--json'], { timeoutMs: this.timeoutMs, env });
      if (result.error || result.timedOut) return { loggedIn: false, detail: result.timedOut ? 'Claude Code no respondió a tiempo' : `No se pudo consultar Claude Code: ${result.error}` };
      try {
        const parsed = JSON.parse(result.stdout.trim()) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string; email?: string };
        if (!parsed.loggedIn) return { loggedIn: false, detail: 'Sin sesión iniciada' };
        const bits = [parsed.subscriptionType ? `Plan ${parsed.subscriptionType}` : null, parsed.authMethod ?? null, parsed.email ?? null].filter(Boolean);
        return { loggedIn: true, detail: bits.join(' · ') || 'Sesión iniciada' };
      } catch {
        return { loggedIn: false, detail: result.code === 0 ? 'Respuesta no reconocida de Claude Code' : 'Sin sesión iniciada' };
      }
    }
    const result = await this.deps.runner(executable, ['login', 'status'], { timeoutMs: this.timeoutMs, env });
    if (result.error || result.timedOut) return { loggedIn: false, detail: result.timedOut ? 'Codex no respondió a tiempo' : `No se pudo consultar Codex: ${result.error}` };
    const text = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
    const loggedIn = result.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
    return { loggedIn, detail: loggedIn ? text.slice(0, 120) : 'Sin sesión iniciada' };
  }
}
