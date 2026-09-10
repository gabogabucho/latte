import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ContentLocale, UiLocale } from '../shared/contracts';
import { api } from './browser-api';
import { interpolate } from './i18n-core';
import { generatedEn, generatedEs } from './i18n-generated';

const es = {
  'settings.back': 'Volver al trabajo',
  'settings.title': 'Ajustes de Latte',
  'settings.scope': 'Configuración de la aplicación',
  'settings.nav': 'Secciones de ajustes',
  'settings.agents': 'Agentes y proveedores',
  'settings.profiles': 'Perfiles',
  'settings.skills': 'Skills',
  'settings.tools': 'Herramientas (MCP)',
  'settings.workspace': 'Espacio local',
  'settings.language': 'Idioma',
  'settings.uiLanguage': 'Idioma de la interfaz',
  'settings.contentLanguage': 'Idioma de contenido nuevo',
  'settings.languageHelp': 'El idioma de contenido solo afecta proyectos y documentos nuevos. Nunca reescribimos proyectos existentes.',
  'settings.spanish': 'Español (Argentina)',
  'settings.english': 'English (United States)',
  'settings.unsavedProfile': 'Hay cambios sin guardar en el perfil. ¿Descartarlos?',
  'settings.dismiss': 'Cerrar aviso',
  'settings.agentsLead': 'Quién hace el trabajo cuando abrís una conversación. Latte no guarda claves ni tokens: cada runtime usa su propio almacén de credenciales.',
  'settings.workspaceLead': 'Todo vive en tu máquina. Latte no sincroniza ni sube nada; estos son los datos reales de esta instalación.',
  'settings.dataFolder': 'Carpeta de datos',
  'settings.database': 'Motor de base',
  'settings.pack': 'Pack de disciplina',
  'settings.version': 'Versión',
  'settings.loading': 'Consultando…',
  'settings.webStorage': 'La vista web guarda en el navegador',
  'settings.filesHelp': 'Los documentos de cada trabajo son Markdown legible dentro de esa carpeta. Podés abrirlos con cualquier editor; Latte detecta los cambios externos cuando volvés.',
  'common.roles': '{count, plural, one {# rol} other {# roles}}',
  'permission.mode.ask': 'Preguntar siempre',
  'permission.mode.folder': 'Trabajar en esta carpeta',
  'permission.mode.auto': 'Automático',
  'permission.help.ask': 'El agente pide permiso antes de cada acción sensible.',
  'permission.help.folder': 'Lee y escribe dentro de este trabajo sin preguntar; otras acciones siguen pidiendo permiso.',
  'permission.help.auto': 'Latte aprueba cada solicitud una sola vez. Podés volver a preguntar cuando quieras.',
  'permission.group': 'Permisos de este trabajo',
  'permission.select': 'Seleccionar {mode}',
  'permission.changing': 'Cambiando permisos',
  'permission.error': 'No se pudieron cambiar los permisos: {message}',
  'permission.preview': 'Los permisos sólo se pueden cambiar desde la app de escritorio.',
  'permission.auto.once': 'Aprueba una vez por solicitud · desactivable al instante',
  'permission.auto.confirmTitle': 'Modo automático para este trabajo.',
  'permission.auto.confirmBody': 'Latte va a aprobar cada pedido del agente una sola vez, sin preguntarte: archivos, comandos, web y herramientas.',
  'permission.auto.claudeWarning': 'Claude Code no tiene sandbox: un comando puede tocar cualquier archivo al que tenga acceso tu usuario, dentro o fuera de la carpeta del trabajo. Codex queda limitado a la carpeta.',
  'permission.auto.confirmAction': 'Podés apagarlo cuando quieras; el pedido siguiente volverá a preguntarte. ¿Activar?',
  'permission.auto.activeWarning': 'Automático está activo. Latte aprueba cada pedido una vez; no guarda permisos permanentes.',
  'chat.permission.claude': 'Claude Code guarda ?siempre? en .claude/ dentro de la carpeta de este trabajo: no vuelve a preguntar por esta herramienta, ni siquiera ma?ana. Otra herramienta distinta s? pregunta.',
  'chat.permission.codex': 'Codex recuerda ?siempre? mientras dure esta conversaci?n. Si la paus?s y la reanud?s, vuelve a preguntar.',
  'chat.permission.opencode': 'OpenCode aplica ?siempre? seg?n su propia configuraci?n. El permiso lo decide el runtime, no Latte.',
  'update.version': 'versi?n {version}',
  'update.newVersion': 'una nueva versi?n',
  'update.available': 'Hay una nueva versi?n de Latte disponible',
  'provider.model.loading': 'Eleg? uno de la lista o escrib? cualquier ID que tu CLI acepte. Buscando el cat?logo del runtime?',
  'provider.model.manual': 'Escrib? un ID de modelo admitido por tu CLI y cuenta.',
  'provider.model.catalog': '{detail} Eleg? uno o escrib? otro ID: quien decide qu? acepta es el runtime.',
  'provider.model.suggestions': '{detail} Son sugerencias, no un cat?logo: pod?s escribir cualquier ID que tu CLI acepte.',
  'app.resumed': '{name}: conversaci?n reanudada',
  'app.runtimeChanged': 'Ahora usa {name}. No se pudo retomar lo anterior: esta conversaci?n empieza limpia.',
  'chat.fileAdded': '{name} se agregó a Latte. Seguís en esta conversación.',
  'stage.discovery': 'Descubrimiento',
  'stage.consideration': 'Consideraci?n',
  'stage.conversion': 'Conversi?n',
  'stage.retention': 'Retenci?n',
  'stage.unclassified': 'Sin clasificar',
  'status.draft': 'Borrador',
  'status.review': 'En revisi?n',
  'status.approved': 'Aprobado',
  'review.outdated': 'Base desactualizada',
  'kind.brief': 'Encargo',
  'kind.strategy': 'Estrategia',
  'kind.calendar': 'Calendario',
  'kind.research': 'Investigaci?n',
  'kind.copy': 'Piezas',
  'kind.note': 'Nota',
  'kindHint.brief': 'Qu? se pide y qu? hay que entregar.',
  'kindHint.strategy': 'Objetivo, audiencia, propuesta, elecciones, restricciones y medici?n.',
  'kindHint.calendar': 'Un mes de acciones: fecha, canal, objetivo, mensaje y CTA.',
  'kindHint.research': 'Evidencia con fuente; lo que no tiene fuente queda como hip?tesis.',
  'kindHint.copy': 'Piezas listas para usar, cada una con su canal y su CTA.',
  'kindHint.note': 'Notas de trabajo.',
  ...generatedEs,
} as const;

export type MessageKey = keyof typeof es;
type Params = Record<string, string | number>;
const en: Record<MessageKey, string> = {
  'settings.back': 'Back to work', 'settings.title': 'Latte settings', 'settings.scope': 'Application settings',
  'settings.nav': 'Settings sections', 'settings.agents': 'Agents and providers', 'settings.profiles': 'Profiles',
  'settings.skills': 'Skills', 'settings.tools': 'Tools (MCP)', 'settings.workspace': 'Local workspace',
  'settings.language': 'Language', 'settings.uiLanguage': 'Interface language', 'settings.contentLanguage': 'Language for new content',
  'settings.languageHelp': 'The content language only affects new projects and documents. Existing projects are never rewritten.',
  'settings.spanish': 'Español (Argentina)', 'settings.english': 'English (United States)',
  'settings.unsavedProfile': 'This profile has unsaved changes. Discard them?', 'settings.dismiss': 'Dismiss notification',
  'settings.agentsLead': 'Choose who does the work when you open a conversation. Latte never stores keys or tokens: each runtime uses its own credential store.',
  'settings.workspaceLead': 'Everything lives on your computer. Latte does not sync or upload anything; these are the actual details for this installation.',
  'settings.dataFolder': 'Data folder', 'settings.database': 'Database engine', 'settings.pack': 'Discipline pack',
  'settings.version': 'Version', 'settings.loading': 'Loading…', 'settings.webStorage': 'The web preview stores data in this browser',
  'settings.filesHelp': 'Each project’s documents are readable Markdown files in that folder. You can open them with any editor; Latte detects external changes when you return.',
  'common.roles': '{count, plural, one {# role} other {# roles}}',
  'permission.mode.ask': 'Always ask', 'permission.mode.folder': 'Work in this folder', 'permission.mode.auto': 'Automatic',
  'permission.help.ask': 'The agent asks before every sensitive action.',
  'permission.help.folder': 'Reads and writes inside this project without asking; other actions still require permission.',
  'permission.help.auto': 'Latte approves each request once. You can switch back to asking at any time.',
  'permission.group': 'Permissions for this project', 'permission.select': 'Select {mode}', 'permission.changing': 'Changing permissions',
  'permission.error': 'Could not change permissions: {message}',
  'permission.preview': 'Permissions can only be changed in the desktop app.',
  'permission.auto.once': 'Approves once per request · turn off instantly',
  'permission.auto.confirmTitle': 'Automatic mode for this project.',
  'permission.auto.confirmBody': 'Latte will approve each agent request once without asking you: files, commands, web, and tools.',
  'permission.auto.claudeWarning': 'Claude Code is not sandboxed: a command can touch any file your user can access, inside or outside the project folder. Codex remains limited to the folder.',
  'permission.auto.confirmAction': 'You can turn it off at any time; the next request will ask again. Enable it?',
  'permission.auto.activeWarning': 'Automatic is active. Latte approves each request once and never stores permanent permission.',
  'chat.permission.claude': 'Claude Code stores ?always? in .claude/ inside this project folder: it will not ask again for this tool, even tomorrow. A different tool will still ask.',
  'chat.permission.codex': 'Codex remembers ?always? for the duration of this conversation. If you pause and resume it, Codex asks again.',
  'chat.permission.opencode': 'OpenCode applies ?always? according to its own configuration. The runtime, not Latte, decides the permission.',
  'update.version': 'version {version}',
  'update.newVersion': 'a new version',
  'update.available': 'A new version of Latte is available',
  'provider.model.loading': 'Choose one from the list or enter any ID your CLI accepts. Loading the runtime catalog?',
  'provider.model.manual': 'Enter a model ID accepted by your CLI and account.',
  'provider.model.catalog': '{detail} Choose one or enter another ID: the runtime decides what it accepts.',
  'provider.model.suggestions': '{detail} These are suggestions, not a catalog: you can enter any ID your CLI accepts.',
  'app.resumed': '{name}: conversation resumed',
  'app.runtimeChanged': 'Now using {name}. The previous conversation could not be resumed, so this one starts fresh.',
  'chat.fileAdded': '{name} was added to Latte. You are still in this conversation.',
  'stage.discovery': 'Discovery',
  'stage.consideration': 'Consideration',
  'stage.conversion': 'Conversion',
  'stage.retention': 'Retention',
  'stage.unclassified': 'Unclassified',
  'status.draft': 'Draft',
  'status.review': 'In review',
  'status.approved': 'Approved',
  'review.outdated': 'Outdated source',
  'kind.brief': 'Brief',
  'kind.strategy': 'Strategy',
  'kind.calendar': 'Calendar',
  'kind.research': 'Research',
  'kind.copy': 'Copy',
  'kind.note': 'Note',
  'kindHint.brief': 'What is requested and what must be delivered.',
  'kindHint.strategy': 'Goal, audience, value proposition, choices, constraints, and measurement.',
  'kindHint.calendar': 'One month of actions: date, channel, goal, message, and CTA.',
  'kindHint.research': 'Sourced evidence; anything without a source remains a hypothesis.',
  'kindHint.copy': 'Ready-to-use pieces, each with its channel and CTA.',
  'kindHint.note': 'Working notes.',
  ...generatedEn,
};
export const catalogs: Record<UiLocale, Record<MessageKey, string>> = { 'es-AR': es, 'en-US': en };

let activeLocale: UiLocale = 'es-AR';

export function formatMessage(locale: UiLocale, key: MessageKey, params: Params = {}): string {
  const template = catalogs[locale][key] ?? catalogs['es-AR'][key];
  return interpolate(locale, template, params);
}
/** Translation helper for presentation-only modules. The provider recreates its
 * direct element on locale changes, so the renderer refreshes without forcing
 * every leaf component to subscribe independently. */
export function translate(key: MessageKey, params: Params = {}): string { return formatMessage(activeLocale, key, params); }
export function currentLocale(): UiLocale { return activeLocale; }

interface I18nValue { locale: UiLocale; contentLocale: ContentLocale; t: (key: MessageKey, params?: Params) => string; setLocale: (v: UiLocale) => Promise<void>; setContentLocale: (v: ContentLocale) => Promise<void> }
const I18nContext = createContext<I18nValue | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>('es-AR');
  const [contentLocale, setContentLocaleState] = useState<ContentLocale>('es-AR');
  useEffect(() => { void Promise.all([api.getUiLocale(), api.getContentLocale()]).then(([ui, content]) => { setLocaleState(ui); setContentLocaleState(content); }); }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const setLocale = useCallback(async (value: UiLocale) => { setLocaleState(await api.setUiLocale(value)); }, []);
  const setContentLocale = useCallback(async (value: ContentLocale) => { setContentLocaleState(await api.setContentLocale(value)); }, []);
  activeLocale = locale;
  const value = useMemo(() => ({ locale, contentLocale, setLocale, setContentLocale, t: (key: MessageKey, params?: Params) => formatMessage(locale, key, params) }), [locale, contentLocale, setLocale, setContentLocale]);
  const rendered = isValidElement(children) ? cloneElement(children) : children;
  return <I18nContext.Provider value={value}>{rendered}</I18nContext.Provider>;
}
export function useI18n(): I18nValue { const value = useContext(I18nContext); if (!value) throw new Error('useI18n must be used inside I18nProvider'); return value; }
