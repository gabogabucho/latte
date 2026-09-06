import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { LatteError } from '../core/errors';
import type { BackendApi } from '../services/latteService';
import { API_ARITY, API_METHODS, channelFor, type ApiMethod, type IpcEnvelope } from './channels';

export interface RegisterOptions {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  api: BackendApi;
  /** Only this WebContents may invoke the API. Everything else is refused. */
  isTrustedSender: (sender: WebContents) => boolean;
  log?: (message: string) => void;
}

/**
 * Registers one handler per contract method. Handlers never throw across the
 * bridge: results travel in an envelope so the renderer gets clean messages
 * and never a stack trace or internal path.
 */
export function registerIpc(options: RegisterOptions): () => void {
  const { ipcMain, api, isTrustedSender, log } = options;

  for (const method of API_METHODS) {
    ipcMain.handle(channelFor(method), async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcEnvelope<unknown>> => {
      if (!isTrustedSender(event.sender)) {
        return { ok: false, code: 'FORBIDDEN', message: 'Untrusted IPC sender' };
      }
      if (args.length > API_ARITY[method]) {
        return { ok: false, code: 'VALIDATION', message: `Too many arguments for ${method}` };
      }
      try {
        const value = await invoke(api, method, args);
        return { ok: true, value };
      } catch (error) {
        return toFailure(method, error, log);
      }
    });
  }

  return () => {
    for (const method of API_METHODS) ipcMain.removeHandler(channelFor(method));
  };
}

function invoke(api: BackendApi, method: ApiMethod, args: unknown[]): Promise<unknown> {
  const fn = api[method] as (...a: unknown[]) => Promise<unknown>;
  return fn.apply(api, args);
}

export function toFailure(method: string, error: unknown, log?: (message: string) => void): IpcEnvelope<never> {
  if (error instanceof LatteError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return { ok: false, code: 'VALIDATION', message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  log?.(`[ipc] ${method} failed: ${message}`);
  return { ok: false, code: 'INTERNAL', message: `${method} failed: ${message}` };
}
