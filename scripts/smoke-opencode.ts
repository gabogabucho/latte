/**
 * Bounded live smoke of the structured chat path against the INSTALLED
 * OpenCode runtime: start `opencode serve` on loopback with random auth,
 * create one session in a throwaway directory, send one tiny prompt and wait
 * for the reply. Uses whatever provider the user already configured; never
 * touches credentials or config. Skips honestly when nothing is configured.
 *
 *   npx tsx scripts/smoke-opencode.ts            (prompt: "Reply LATTE_OK")
 *   LATTE_SMOKE_NO_INFERENCE=1 npx tsx scripts/smoke-opencode.ts   (protocol only)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatManager, summariseProviders } from '../electron/opencode/chatManager';
import { OpenCodeClient } from '../electron/opencode/client';
import { OpenCodeServer } from '../electron/opencode/server';
import { execFileRunner } from '../electron/runtime/commandRunner';
import { RuntimeDetector } from '../electron/runtime/detect';
import type { ChatEvent } from '../shared/contracts';

const result: Record<string, unknown> = { startedAt: new Date().toISOString(), inference: process.env.LATTE_SMOKE_NO_INFERENCE !== '1' };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-smoke-opencode-'));
const workDir = path.join(root, 'work');
fs.mkdirSync(workDir, { recursive: true });
fs.writeFileSync(path.join(workDir, 'AGENTS.md'), '# Latte smoke\n\nThis is a throwaway directory. Reply briefly. Do not use tools.\n');

const detector = new RuntimeDetector({ runner: execFileRunner, terminalAvailability: () => ({ available: true }) });
const events: ChatEvent[] = [];
let server: OpenCodeServer | null = null;
let manager: ChatManager | null = null;

async function main(): Promise<void> {
  const runtime = await detector.resolve('opencode');
  if (!runtime) throw new Error('opencode not found on PATH');
  result.runtime = { executable: runtime.executable, version: runtime.version };

  server = new OpenCodeServer({ executable: runtime.executable, cwd: root, startupTimeoutMs: 45_000 });
  const started = Date.now();
  const endpoint = await server.ensure();
  result.serverStartupMs = Date.now() - started;
  result.baseUrl = endpoint.baseUrl;

  const client = new OpenCodeClient(endpoint, { timeoutMs: 20_000 });
  const health = await client.health();
  result.health = health;
  const providers = summariseProviders(await client.providers(workDir));
  result.models = providers.models;
  result.defaultModel = providers.defaultModel;
  if (providers.models.length === 0) {
    result.outcome = 'skipped: no provider configured in OpenCode (run "opencode auth login")';
    return;
  }

  manager = new ChatManager({
    resolveExecutable: async () => ({ executable: runtime.executable, version: runtime.version }),
    serverCwd: root,
    emit: (e) => events.push(e),
    endpoint,
    clientTimeoutMs: 20_000,
  });
  const { session, opencodeSessionId } = await manager.start({ workId: 'wrk_smoke', directory: workDir, title: 'Latte smoke' });
  result.session = { chatId: session.id, opencodeSessionId, model: session.model };

  if (process.env.LATTE_SMOKE_NO_INFERENCE === '1') {
    result.outcome = 'protocol-only: session created, no prompt sent';
    await client.deleteSession(opencodeSessionId, workDir).catch(() => {});
    return;
  }

  const promptStarted = Date.now();
  await manager.send(session.id, 'Reply with exactly LATTE_OK and nothing else. Do not use any tools.');
  const deadline = Date.now() + 120_000;
  let sawBusy = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    if (events.some((e) => e.type === 'status' && e.status === 'busy')) sawBusy = true;
    const error = events.find((e) => e.type === 'error');
    if (error) {
      // Never persist account URLs or ids from provider errors.
      result.outcome = `error: ${error.message.replace(/https?:\/\/\S+/g, '[url]')}`;
      break;
    }
    const permission = events.find((e) => e.type === 'permission');
    if (permission) {
      await manager.replyPermission(session.id, permission.request.id, 'reject');
      result.permissionRejected = permission.request.permission;
    }
    const messages = manager.listMessages(session.id);
    const assistant = messages.find((m) => m.role === 'assistant');
    const idle = sawBusy && events.some((e, i) => e.type === 'status' && e.status === 'idle' && i > events.findIndex((x) => x.type === 'status' && x.status === 'busy'));
    if (assistant && (assistant.completed || idle)) {
      const text = assistant.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('').trim();
      result.replyMs = Date.now() - promptStarted;
      result.assistantText = text.slice(0, 200);
      result.assistantError = assistant.error;
      result.outcome = text.includes('LATTE_OK') ? 'pass' : `reply received but unexpected: ${text.slice(0, 80)}`;
      break;
    }
  }
  result.outcome ??= 'timeout: no completed assistant reply within 120 s';
  result.eventTypes = [...new Set(events.map((e) => e.type))];
  await client.deleteSession(opencodeSessionId, workDir).catch(() => {});
}

main()
  .catch((error) => { result.outcome = `failed: ${error instanceof Error ? error.message : String(error)}`; })
  .finally(async () => {
    manager?.shutdown();
    server?.stop();
    result.finishedAt = new Date().toISOString();
    const out = path.resolve('scripts', 'smoke-opencode-result.json');
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    // The server process releases its cwd asynchronously; best-effort cleanup.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 300)); }
    }
    process.exit(typeof result.outcome === 'string' && (result.outcome === 'pass' || result.outcome.startsWith('skipped') || result.outcome.startsWith('protocol-only')) ? 0 : 1);
  });
