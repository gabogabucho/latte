import { createRequire } from 'node:module';
import path from 'node:path';

const base = typeof __filename === 'string' && __filename.length > 0
  ? __filename
  : path.join(process.cwd(), 'package.json');

const localRequire = createRequire(base);

export type OptionalModule<T> = { ok: true; module: T } | { ok: false; error: string };

/**
 * Loads a module that may legitimately be absent or broken at runtime
 * (native addons, experimental builtins). Never throws: callers decide how to
 * degrade, and the reason is preserved so the UI can show it honestly.
 */
export function optionalRequire<T>(id: string): OptionalModule<T> {
  try {
    return { ok: true, module: localRequire(id) as T };
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { ok: false, error: `${id}: ${message}` };
  }
}
