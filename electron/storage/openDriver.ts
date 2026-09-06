import fs from 'node:fs';
import path from 'node:path';
import type { SqlDriver } from './driver';
import { loadNodeSqlite, NodeSqliteDriver } from './nodeSqliteDriver';
import { SqlJsDriver } from './sqljsDriver';

export type DriverPreference = 'auto' | 'node:sqlite' | 'sql.js' | 'sqljs';

export interface OpenDriverResult {
  driver: SqlDriver;
  /** Human readable explanation of which engine was picked and why. */
  reason: string;
}

/**
 * Strategy: prefer the builtin engine (real file database, durable per
 * statement, no dependencies); fall back to WebAssembly when the builtin is
 * missing in the running Node/Electron. Both use the same file, so the
 * fallback opens data written by the primary and vice-versa.
 */
export async function openDriver(file: string, requested: DriverPreference = 'auto'): Promise<OpenDriverResult> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const preference = requested === 'sqljs' ? 'sql.js' : requested;

  if (preference !== 'sql.js') {
    const builtin = loadNodeSqlite();
    if (builtin.ok) {
      return { driver: new NodeSqliteDriver(file, builtin.module), reason: 'node:sqlite builtin available' };
    }
    if (preference === 'node:sqlite') {
      throw new Error(`node:sqlite requested but unavailable: ${builtin.error}`);
    }
    const driver = await SqlJsDriver.open(file);
    return { driver, reason: `node:sqlite unavailable (${builtin.error}); using sql.js WebAssembly fallback` };
  }

  const driver = await SqlJsDriver.open(file);
  return { driver, reason: 'sql.js explicitly requested' };
}
