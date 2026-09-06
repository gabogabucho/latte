import { optionalRequire } from '../core/optionalRequire';

export interface PtyDisposable {
  dispose(): void;
}

export interface PtyProcessLike {
  readonly pid: number;
  onData(listener: (data: string) => void): PtyDisposable;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): PtyDisposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export interface PtyModuleLike {
  spawn(file: string, args: string[], options: PtySpawnOptions): PtyProcessLike;
}

export type PtyLoadResult = { ok: true; module: PtyModuleLike } | { ok: false; error: string };

let cached: PtyLoadResult | null = null;

/**
 * node-pty is an optional native dependency. Its prebuilt N-API binary loads
 * in both Node and Electron without rebuilding, but if the platform has no
 * prebuild (or the binary is broken) we report that instead of pretending.
 */
export function loadPty(): PtyLoadResult {
  if (cached) return cached;
  const loaded = optionalRequire<PtyModuleLike>('node-pty');
  if (!loaded.ok) {
    cached = { ok: false, error: loaded.error };
  } else if (typeof loaded.module.spawn !== 'function') {
    cached = { ok: false, error: 'node-pty loaded but exposes no spawn()' };
  } else {
    cached = loaded;
  }
  return cached;
}
