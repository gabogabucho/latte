/**
 * Bounded live smoke of the Claude Code chat path through the real backend:
 * temp data dir, one brand/work, primary agent = Claude Code (system profile),
 * one tiny prompt, wait for the reply. Uses the user's existing Claude Code
 * login; Latte never touches credentials.
 *
 *   npx tsx scripts/smoke-claude.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBackend } from '../electron/bootstrap';
import type { ChatEvent } from '../shared/contracts';

const result: Record<string, unknown> = { startedAt: new Date().toISOString() };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'latte-smoke-claude-'));
const events: ChatEvent[] = [];

async function main(): Promise<void> {
  const backend = await createBackend({ dataDir: root, version: 'smoke', seedDemo: false, emit: () => {}, emitChat: (e) => events.push(e), chooseExportPath: async () => null });
  try {
    const runtimes = await backend.service.listAgentRuntimes();
    const claude = runtimes.find((r) => r.runtime === 'claude');
    result.claude = { installed: claude?.installed, version: claude?.version, systemLoggedIn: claude?.accounts[0]?.loggedIn, systemDetail: claude?.accounts[0]?.detail };
    if (!claude?.installed || !claude.accounts[0]?.loggedIn) {
      result.outcome = 'skipped: Claude Code not installed or not logged in';
      return;
    }
    const brand = await backend.service.createBrand('Smoke');
    const work = await backend.service.createWork(brand.id, 'Prueba Claude');
    result.primary = await backend.service.setPrimaryAgent({ runtime: 'claude', model: null, accountId: 'system' });
    const chat = await backend.service.startChat(work.id);
    result.session = { provider: chat.provider, label: chat.label, resumed: chat.resumed };
    const started = Date.now();
    await backend.service.sendChat(chat.id, 'Reply with exactly LATTE_OK and nothing else. Do not use any tools.');
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      const error = events.find((e) => e.type === 'error');
      if (error) { result.outcome = `error: ${error.message}`; break; }
      const permission = events.find((e) => e.type === 'permission');
      if (permission) { await backend.service.replyPermission(chat.id, permission.request.id, 'reject'); result.permissionRejected = permission.request.permission; }
      const idleAfterBusy = events.some((e) => e.type === 'status' && e.status === 'busy') && events.at(-1)?.type === 'status' && (events.at(-1) as { status: string }).status === 'idle';
      const messages = await backend.service.listChatMessages(chat.id);
      const assistant = messages.find((m) => m.role === 'assistant');
      if (assistant && (assistant.completed || idleAfterBusy)) {
        const text = assistant.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('').trim();
        result.replyMs = Date.now() - started;
        result.assistantText = text.slice(0, 200);
        result.outcome = text.includes('LATTE_OK') ? 'pass' : `reply received but unexpected: ${text.slice(0, 80)}`;
        break;
      }
    }
    result.outcome ??= 'timeout: no completed reply within 120 s';
    result.eventTypes = [...new Set(events.map((e) => e.type))];
    result.persistedSessionId = Boolean(backend.repo.getChatSession(work.id, 'claude'));
    await backend.service.stopChat(chat.id);
  } finally {
    backend.service.shutdown();
  }
}

main()
  .catch((error) => { result.outcome = `failed: ${error instanceof Error ? error.message : String(error)}`; })
  .finally(async () => {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.resolve('scripts', 'smoke-claude-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 300)); }
    }
    process.exit(result.outcome === 'pass' || String(result.outcome).startsWith('skipped') ? 0 : 1);
  });
