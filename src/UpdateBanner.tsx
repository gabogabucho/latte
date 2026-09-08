import { useEffect, useState } from 'react';
import { Download, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { UpdateState } from '../shared/contracts';
import { api } from './browser-api';

const START: UpdateState = { phase: 'idle', version: null, percent: 0, message: '' };
/** Identity of what is being offered: dismissing one state must not hide the next. */
const key = (state: UpdateState) => `${state.phase}:${state.version ?? ''}`;

/**
 * The update notice.
 *
 * It never interrupts: downloading happens while you keep working, and the
 * restart is a button, never a countdown. The one thing it will not do is let
 * an update start over an unsaved document — the main process refuses, and
 * this explains why instead of failing quietly.
 */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>(START);
  const [dismissed, setDismissed] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState('');

  useEffect(() => {
    const stop = api.onUpdateState(next => { setState(next); setBlocked(''); });
    // The state may already have moved before this mounted; asking returns it.
    void api.checkForUpdate().then(setState).catch(() => undefined);
    return stop;
  }, []);

  const visible = state.phase === 'available' || state.phase === 'downloading' || state.phase === 'ready' || (state.phase === 'error' && state.version !== null);
  if (!visible || dismissed === key(state)) return null;

  const download = () => {
    setBusy(true);
    setBlocked('');
    void api.downloadUpdate().then(setState).catch(() => undefined).finally(() => setBusy(false));
  };
  const install = () => {
    setBusy(true);
    setBlocked('');
    void api.installUpdate()
      .then(outcome => {
        // 'installing' quits the app; 'cancelled' is an answer, not an error.
        if (outcome.status === 'unsaved') setBlocked('Tenés cambios sin guardar. Guardalos o descartalos y volvé a intentar: la actualización no empieza sobre un documento abierto.');
        else if (outcome.status === 'not-ready') setBlocked('La actualización todavía no terminó de descargarse.');
      })
      .catch(() => setBlocked('No se pudo iniciar la actualización. Latte sigue funcionando normalmente.'))
      .finally(() => setBusy(false));
  };
  const later = () => setDismissed(key(state));
  const version = state.version ? `versión ${state.version}` : 'una nueva versión';

  return <section className={'update-toast' + (state.phase === 'ready' ? ' ready' : '')} role="status" aria-live="polite">
    <div className="update-toast-head">
      <strong>{
        state.phase === 'ready' ? 'Actualización lista para instalar'
          : state.phase === 'downloading' ? `Descargando la ${version}`
            : state.phase === 'error' ? 'No se pudo actualizar'
              : `Hay una nueva versión de Latte disponible`
      }</strong>
      <button className="icon-button" aria-label="Ocultar el aviso" title="Ocultar el aviso" onClick={later}><X size={15} /></button>
    </div>

    {state.phase === 'available' && <p>Latte {state.version} está publicada. Podés descargarla ahora y seguir trabajando mientras tanto.</p>}
    {state.phase === 'downloading' && <>
      <p>Seguí trabajando: se descarga en segundo plano y te avisamos cuando esté lista.</p>
      <div className="update-progress"><i style={{ width: `${state.percent}%` }} /></div>
    </>}
    {state.phase === 'ready' && <p><strong>Guardá tus documentos antes de continuar.</strong> Latte se reinicia para instalar la {version} y se detienen los agentes y las terminales que estén activos.</p>}
    {state.phase === 'error' && <p>{state.message}</p>}
    {blocked && <p className="update-blocked" role="alert">{blocked}</p>}

    <div className="update-actions">
      {state.phase === 'available' && <button className="primary" disabled={busy} onClick={download}>{busy ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}Descargar actualización</button>}
      {state.phase === 'ready' && <button className="primary" disabled={busy} onClick={install}>{busy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}Reiniciar e instalar</button>}
      {state.phase === 'error' && <button disabled={busy} onClick={download}>{busy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}Reintentar</button>}
      {state.phase !== 'downloading' && <button className="subtle" onClick={later}>Más tarde</button>}
    </div>
  </section>;
}
