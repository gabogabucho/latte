import { execFile } from 'node:child_process';
import path from 'node:path';

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Spawn-level failure (ENOENT, EACCES...). Empty when the process ran. */
  error?: string;
}

export interface CommandOptions {
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** Runs one executable with an argument ARRAY. Never a shell string. */
export type CommandRunner = (file: string, args: string[], options: CommandOptions) => Promise<CommandResult>;

export interface SpawnSpec {
  file: string;
  args: string[];
}

/**
 * Windows cannot CreateProcess a .cmd/.bat shim directly (Node refuses with
 * EINVAL since the 2024 hardening). Those go through cmd.exe /c with the
 * absolute path as a discrete argument, so nothing is ever string-concatenated.
 */
export function spawnSpecFor(executable: string, extraArgs: string[] = [], platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): SpawnSpec {
  const ext = path.extname(executable).toLowerCase();
  if (platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    return { file: env.ComSpec ?? 'cmd.exe', args: ['/c', executable, ...extraArgs] };
  }
  return { file: executable, args: [...extraArgs] };
}

export const execFileRunner: CommandRunner = (file, args, options) =>
  new Promise((resolve) => {
    const spec = spawnSpecFor(file, args, process.platform, options.env ?? process.env);
    let timedOut = false;
    execFile(
      spec.file,
      spec.args,
      {
        timeout: options.timeoutMs,
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
        killSignal: 'SIGKILL',
      },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) timedOut = true;
        const spawnFailure = error && typeof (error as NodeJS.ErrnoException).code === 'string' && (error as NodeJS.ErrnoException).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          ? `${(error as NodeJS.ErrnoException).code}: ${error.message.split('\n')[0]}`
          : undefined;
        const exitCode = error && typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : error ? null : 0;
        resolve({
          code: exitCode,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut,
          error: spawnFailure,
        });
      },
    );
  });
