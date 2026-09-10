# RUN — Linux

## Baseline 2026-09-10

Worktree: `~/src/latte-wt-T0`, rama `feat/linux-T0-baseline`, base `6a000d6`.
Máquina: Linux Mint 22.3. Node local sin cambios.

| comando | exit code | resultado |
|---|---|---|
| `node --version` | 0 | `v26.7.0` |
| `npm --version` | 0 | `11.19.0` |
| `npm ci` | 0 | `added 488 packages, audited 489, found 0 vulnerabilities` (11s; avisos: boolean@3.2.0 deprecated; install-scripts pendientes: electron-winstaller, esbuild, node-pty) |
| `npm run probe:electron` | 0 | `OK electron: 44.2.0`, `OK node: 24.20.0`, `OK node:sqlite: 3.53.4`, `OK node-pty: loaded`, `OK sql.js: loaded`, `OK tsx/cjs: resolvable` |
| `npm run typecheck:all` | 0 | `tsc electron + web + web-tests`, sin errores |
| `npm test` | 1 | `6 failed / 31 passed files; 9 failed / 290 passed tests`. Fallos: agents (2, list/installed + login), chat (1, shim Windows), codex (1, binario Windows), detect (1, .exe Windows), mcp (3, CLI runtime), service (1, Engram CLI ausente en PATH). Resto verde. |
| `which opencode` | 0 | `/home/pablo/.local/bin/opencode` |
| `opencode --version` | 0 | `1.18.30` |
| `LATTE_SMOKE_EXIT_MS=15000 npm run smoke:desktop` | 0 | `renderer loaded=true consoleErrors=0`; seed demo brand; opencode server en 4096; avisos GPU no fatales (MESA Haswell Vulkan, libva iHD) |
| `LATTE_SMOKE_NO_INFERENCE=1 npx tsx scripts/smoke-opencode.ts` | 0 | `protocol-only: session created, no prompt sent` (chatId `ses_9cf97d8e45b53d797b25`, defaultModel `opencode-go/gpt-5.6-luna`) |
| `npm run dev` (ventana, kill = Ctrl+C) | 143 (SIGTERM, cierre manual) | ventana abrió (log main+renderer+gpu, cerrada con kill). Sin fallo sandbox → no se añaden flags. Solo avisos GPU no fatales (MESA-INTEL Haswell Vulkan incomplete; `libva iHD_drv_video.so init failed`). |

Salidas completas verificadas en la corrida local (no se versionan logs).
