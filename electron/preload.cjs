'use strict';
// Preload runs in an isolated world with the sandbox on. It exposes exactly the
// LatteAPI surface from shared/contracts.ts and nothing else: no generic
// invoke, no channel names from the renderer, no Node objects.
const { contextBridge, ipcRenderer } = require('electron');

// Keep in sync with electron/ipc/channels.ts (tests assert equality).
const METHODS = [
  'appInfo',
  'listBrands',
  'createBrand',
  'updateBrand',
  'listWorks',
  'createWork',
  'saveBrief',
  'listRevisions',
  'snapshot',
  'listDocuments',
  'readDocument',
  'documentState',
  'createDocument',
  'saveDocument',
  'updateDocument',
  'snapshotDocument',
  'keepDraftAsVersion',
  'listDocumentRevisions',
  'exportDocument',
  'listUntrackedFiles',
  'listFolderEntries',
  'listSkills',
  'setSkillEnabled',
  'applyFunnelProposal',
  'dismissFunnelProposal',
  'getFolderTrust',
  'setFolderTrust',
  'trackFile',
  'saveAsDocument',
  'acknowledgeBase',
  'useFolder',
  'listDecisions',
  'addDecision',
  'runtimeStatus',
  'startAgent',
  'writeAgent',
  'resizeAgent',
  'stopAgent',
  'readMemory',
  'saveMemory',
  'exportWork',
  'chatStatus',
  'startChat',
  'listChatMessages',
  'sendChat',
  'abortChat',
  'stopChat',
  'replyPermission',
  'replyQuestion',
  'listProviders',
  'connectProviderKey',
  'disconnectProvider',
  'startProviderOAuth',
  'completeProviderOAuth',
  'getPrimaryAgent',
  'setPrimaryAgent',
  'listAgentRuntimes',
  'listMcpServers',
  'addMcpServer',
  'removeMcpServer',
  'addAgentAccount',
  'removeAgentAccount',
  'startAccountLogin',
  'logoutAccount',
  'listRoles',
  'listProfiles',
  'saveProfile',
  'listTeam',
  'addTeamMember',
  'openTeamMember',
  'pauseTeamMember',
  'finishTeamMember',
  'restartTeamMember',
  'removeTeamMember',
];

const AGENT_EVENT_CHANNEL = 'latte:agent-event';
const CHAT_EVENT_CHANNEL = 'latte:chat-event';
const UNSAVED_CHANNEL = 'latte:unsaved';
const WINDOW_CHANNEL = 'latte:window';
const WINDOW_STATE_CHANNEL = 'latte:window-state';

function unwrap(envelope) {
  if (envelope && envelope.ok === true) return envelope.value;
  const error = new Error(envelope && envelope.message ? envelope.message : 'Unknown IPC failure');
  error.code = envelope && envelope.code ? envelope.code : 'INTERNAL';
  throw error;
}

const api = {};
for (const method of METHODS) {
  api[method] = (...args) => ipcRenderer.invoke(`latte:${method}`, ...args).then(unwrap);
}

// One-way: the renderer states whether there is unsaved work; the main process
// decides what to do about it when the window is closed.
api.reportUnsaved = (hasUnsavedWork) => ipcRenderer.send(UNSAVED_CHANNEL, Boolean(hasUnsavedWork));

api.windowControl = (action) => {
  if (action === 'minimize' || action === 'maximize' || action === 'close') ipcRenderer.send(WINDOW_CHANNEL, action);
};

api.onWindowState = (callback) => {
  if (typeof callback !== 'function') throw new TypeError('onWindowState expects a function');
  const listener = (_event, payload) => callback({ maximized: Boolean(payload && payload.maximized) });
  ipcRenderer.on(WINDOW_STATE_CHANNEL, listener);
  return () => ipcRenderer.removeListener(WINDOW_STATE_CHANNEL, listener);
};

api.onAgentEvent = (callback) => {
  if (typeof callback !== 'function') throw new TypeError('onAgentEvent expects a function');
  const listener = (_event, payload) => {
    if (payload && typeof payload.sessionId === 'string' && typeof payload.type === 'string') {
      callback({ sessionId: payload.sessionId, type: payload.type, data: String(payload.data ?? '') });
    }
  };
  ipcRenderer.on(AGENT_EVENT_CHANNEL, listener);
  return () => ipcRenderer.removeListener(AGENT_EVENT_CHANNEL, listener);
};

api.onChatEvent = (callback) => {
  if (typeof callback !== 'function') throw new TypeError('onChatEvent expects a function');
  const listener = (_event, payload) => {
    if (payload && typeof payload.chatId === 'string' && typeof payload.type === 'string') callback(payload);
  };
  ipcRenderer.on(CHAT_EVENT_CHANNEL, listener);
  return () => ipcRenderer.removeListener(CHAT_EVENT_CHANNEL, listener);
};

contextBridge.exposeInMainWorld('latte', Object.freeze(api));
