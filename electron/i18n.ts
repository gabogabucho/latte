import type { UiLocale } from '../shared/contracts';

const es = {
  htmlTitle: 'Abrir HTML externo', htmlMessage: '¿Abrir {fileName}?', htmlDetail: 'El HTML puede ejecutar scripts y conectarse a Internet. Se abrirá en la aplicación externa predeterminada, no dentro de Latte. Abrilo solo si confiás en su contenido.',
  cancel: 'Cancelar', open: 'Abrir', restart: 'Reiniciar e instalar', later: 'Más tarde', updateTitle: 'Actualizar Latte a {version}', saveDocuments: 'Guardá tus documentos antes de continuar.',
  updateLive: 'Latte se cierra para instalar la actualización. Se detienen {live} en curso. Tus documentos guardados, tus versiones y tus decisiones no se tocan.',
  updateIdle: 'Latte se cierra y vuelve a abrir para instalarla. Tus documentos guardados, tus versiones y tus decisiones no se tocan.',
  conversationOne: '{count} conversación', conversationMany: '{count} conversaciones', terminalOne: '{count} terminal', terminalMany: '{count} terminales', and: ' y ',
  closeAnyway: 'Cerrar igual', unsavedTitle: 'Cambios sin guardar', unsavedMessage: 'Tenés cambios sin guardar en un documento.', unsavedDetail: 'Si cerrás ahora, se pierden. Las conversaciones abiertas y las versiones ya guardadas no se ven afectadas.',
  newerTitle: 'Tus datos son de una versión más nueva de Latte', openFailedTitle: 'Latte no pudo abrir tus datos', newerDetail: '{error}\n\nNo se abrió ni se modificó nada. Instalá la versión más reciente de Latte y volvé a intentar.', diskDetail: '{error}\n\nTus datos siguen en disco, tal como estaban.',
  exportTitle: 'Exportar entregable', originalFormat: 'Formato original', allFiles: 'Todos los archivos', importTitle: 'Elegí los archivos que querés traer a este trabajo', importButton: 'Traer al trabajo', folderTitle: 'Elegí la carpeta de este trabajo', folderButton: 'Usar esta carpeta',
} as const;
type Key = keyof typeof es;
const en: Record<Key,string> = {
  htmlTitle: 'Open external HTML', htmlMessage: 'Open {fileName}?', htmlDetail: 'HTML can run scripts and connect to the Internet. It will open in your default external application, not inside Latte. Open it only if you trust its contents.',
  cancel: 'Cancel', open: 'Open', restart: 'Restart and install', later: 'Later', updateTitle: 'Update Latte to {version}', saveDocuments: 'Save your documents before continuing.',
  updateLive: 'Latte will close to install the update. {live} currently running will be stopped. Your saved documents, versions, and decisions will not be changed.', updateIdle: 'Latte will close and reopen to install it. Your saved documents, versions, and decisions will not be changed.',
  conversationOne: '{count} conversation', conversationMany: '{count} conversations', terminalOne: '{count} terminal', terminalMany: '{count} terminals', and: ' and ',
  closeAnyway: 'Close anyway', unsavedTitle: 'Unsaved changes', unsavedMessage: 'You have unsaved changes in a document.', unsavedDetail: 'If you close now, they will be lost. Open conversations and saved versions are not affected.',
  newerTitle: 'Your data belongs to a newer version of Latte', openFailedTitle: 'Latte could not open your data', newerDetail: '{error}\n\nNothing was opened or changed. Install the latest version of Latte and try again.', diskDetail: '{error}\n\nYour data remains on disk exactly as it was.',
  exportTitle: 'Export deliverable', originalFormat: 'Original format', allFiles: 'All files', importTitle: 'Choose the files to bring into this project', importButton: 'Bring into project', folderTitle: 'Choose this project’s folder', folderButton: 'Use this folder',
};
export function mainMessage(locale: UiLocale, key: Key, params: Record<string,string|number> = {}): string {
  return (locale === 'en-US' ? en[key] : es[key]).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
