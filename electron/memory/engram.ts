import type { MemoryResult } from '../../shared/contracts';
import type { CommandRunner } from '../runtime/commandRunner';

export interface EngramClientDeps {
  runner: CommandRunner;
  /** Resolves the engram executable (absolute path) or null when not installed. */
  locate: () => Promise<string | null>;
  timeoutMs?: number;
  maxOutputChars?: number;
}

const BANNER_PREFIXES = ['Update available:', 'To update:', 'go install ', 'or: https://'];

/** The engram binary prints an upgrade banner before real output; drop it. */
export function stripEngramBanner(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => !BANNER_PREFIXES.some((prefix) => line.trim().startsWith(prefix)))
    .join('\n')
    .trim();
}

/**
 * Thin adapter over the `engram` CLI (Gentleman-Programming/engram).
 * Read = `engram context <project>`, save = `engram save <title> <text>`.
 * Every call is bounded by a timeout and degrades to {available:false}.
 */
export class EngramClient {
  private readonly timeoutMs: number;
  private readonly maxOutputChars: number;

  constructor(private readonly deps: EngramClientDeps) {
    this.timeoutMs = deps.timeoutMs ?? 8_000;
    this.maxOutputChars = deps.maxOutputChars ?? 20_000;
  }

  async read(project: string): Promise<MemoryResult> {
    const binary = await this.deps.locate();
    if (!binary) return unavailable('Engram CLI not found on PATH. Install it to enable brand memory.');
    const result = await this.deps.runner(binary, ['context', project], { timeoutMs: this.timeoutMs });
    if (result.timedOut) return unavailable(`Engram did not answer within ${this.timeoutMs} ms`);
    if (result.error) return unavailable(`Engram could not run: ${result.error}`);
    if (result.code !== 0) return unavailable(`Engram exited with code ${result.code}: ${stripEngramBanner(result.stderr).slice(0, 300)}`);
    const text = stripEngramBanner(result.stdout).slice(0, this.maxOutputChars);
    return { available: true, text };
  }

  async save(project: string, title: string, text: string, type = 'decision'): Promise<MemoryResult> {
    const binary = await this.deps.locate();
    if (!binary) return unavailable('Engram CLI not found on PATH. Install it to enable brand memory.');
    const result = await this.deps.runner(
      binary,
      ['save', title, text, '--type', type, '--project', project, '--scope', 'project'],
      { timeoutMs: this.timeoutMs },
    );
    if (result.timedOut) return unavailable(`Engram did not answer within ${this.timeoutMs} ms`);
    if (result.error) return unavailable(`Engram could not run: ${result.error}`);
    if (result.code !== 0) return unavailable(`Engram exited with code ${result.code}: ${stripEngramBanner(result.stderr).slice(0, 300)}`);
    return { available: true, text: stripEngramBanner(result.stdout) || 'Memory saved.' };
  }
}

function unavailable(text: string): MemoryResult {
  return { available: false, text };
}

/** One Engram project per brand, keyed by the immutable brand id only. */
export function memoryProjectFor(brandId: string): string {
  return `latte-${brandId}`;
}
