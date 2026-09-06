import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, HardDrive, Info, Plug, Wrench } from 'lucide-react';
import type { AppInfo } from '../shared/contracts';
import { api, isDesktop } from './browser-api';
import { ProvidersView } from './ProvidersView';
import { ToolsView } from './ToolsView';

export type SettingsSection = 'agents' | 'tools' | 'workspace';

/**
 * Settings is its own screen, not a document view: no work breadcrumb, no
 * Brief/Decisiones tabs, no export, no versions footer and no team panel.
 * Opening or closing it never writes anything; the workspace state stays in
 * App and comes back untouched.
 */
export function SettingsScreen({ controls, section, onSection, onClose, onChanged, onNotice, onError, notice, error, onDismiss }: {
  /** Window controls: Settings is a full screen, so it needs them too. */
  controls: ReactNode;
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onClose: () => void;
  onChanged: () => void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  notice: string;
  error: string;
  onDismiss: () => void;
}) {
  return <div className="settings-shell">
    <header className="settings-topbar">
      <button className="settings-back" onClick={onClose}><ArrowLeft size={16} />Volver al trabajo</button>
      <h1>Ajustes de Latte</h1>
      <span className="settings-scope">Configuración de la aplicación</span>
      {controls}
    </header>
    <nav className="settings-nav" aria-label="Secciones de ajustes">
      <button className={section === 'agents' ? 'selected' : ''} onClick={() => onSection('agents')}><Plug size={16} />Agentes y proveedores</button>
      <button className={section === 'tools' ? 'selected' : ''} onClick={() => onSection('tools')}><Wrench size={16} />Herramientas (MCP)</button>
      <button className={section === 'workspace' ? 'selected' : ''} onClick={() => onSection('workspace')}><HardDrive size={16} />Espacio local</button>
    </nav>
    <main className="settings-main">
      {(error || notice) && <div role={error ? 'alert' : 'status'} className={'message ' + (error ? 'error' : '')}><span>{error || notice}</span><button aria-label="Cerrar aviso" onClick={onDismiss}>×</button></div>}
      {section === 'agents' && <section className="settings-section">
        <h2>Agentes y proveedores</h2>
        <p className="settings-lead">Quién hace el trabajo cuando abrís una conversación. Latte no guarda claves ni tokens: cada runtime usa su propio almacén de credenciales.</p>
        <ProvidersView onChanged={onChanged} onNotice={onNotice} onError={onError} />
      </section>}
      {section === 'tools' && <ToolsView onNotice={onNotice} onError={onError} />}
      {section === 'workspace' && <WorkspaceSection onError={onError} />}
    </main>
  </div>;
}

function WorkspaceSection({ onError }: { onError: (text: string) => void }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => { void api.appInfo().then(setInfo).catch(e => onError(e instanceof Error ? e.message : String(e))); }, []);
  return <section className="settings-section">
    <h2>Espacio local</h2>
    <p className="settings-lead">Todo vive en tu máquina. Latte no sincroniza ni sube nada; estos son los datos reales de esta instalación.</p>
    <dl className="settings-facts">
      <div><dt>Carpeta de datos</dt><dd><code>{info?.dataDir ?? (isDesktop ? 'Consultando…' : 'La vista web guarda en el navegador')}</code></dd></div>
      <div><dt>Motor de base</dt><dd>{info ? `${info.engine}${info.engineReason ? ` · ${info.engineReason}` : ''}` : '—'}</dd></div>
      <div><dt>Pack de disciplina</dt><dd>{info?.pack ?? '—'}{info && info.packRoles > 0 ? ` · ${info.packRoles} roles` : ''}</dd></div>
      <div><dt>Versión</dt><dd>Latte 0.1 · ALPHA</dd></div>
    </dl>
    <p className="footnote"><Info size={13} /> Los documentos de cada trabajo son Markdown legible dentro de esa carpeta. Podés abrirlos con cualquier editor; Latte detecta los cambios externos cuando volvés.</p>
  </section>;
}
