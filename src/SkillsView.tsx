import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { AgentSkill } from '../shared/contracts';
import { api, isDesktop } from './browser-api';

/**
 * Skills Latte ships: how every agent writes, in every work.
 *
 * A role is who does the job; a skill is the craft everyone shares. They are on
 * by default on purpose — quality that each person has to discover and switch
 * on is quality almost nobody gets. The switch exists so you can turn one off,
 * not so you have to turn it on.
 *
 * They travel in the work's instruction file, written once per conversation,
 * not in the prompt charged on every message.
 */
export function SkillsView({ onError, onNotice }: { onError: (text: string) => void; onNotice: (text: string) => void }) {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let live = true;
    api.listSkills()
      .then(list => { if (live) setSkills(list); })
      .catch(e => { if (live) onError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  const toggle = async (skill: AgentSkill) => {
    setBusy(skill.id);
    try {
      setSkills(await api.setSkillEnabled(skill.id, !skill.enabled));
      onNotice(skill.enabled
        ? `"${skill.name}" queda apagada. Se aplica al iniciar o reanudar una conversación.`
        : `"${skill.name}" queda activa. Se aplica al iniciar o reanudar una conversación.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return <section className="settings-section">
    <h2>Skills</h2>
    <p className="settings-lead">Cómo escribe el equipo, en todos los trabajos. Un rol es quién hace el trabajo; una skill es el oficio que comparten todos.</p>
    {!isDesktop && <p className="profile-disclaimer">Vista web: las skills se aplican en la aplicación de escritorio, donde vive la conversación con el agente.</p>}
    {loading && <p className="footnote">Cargando skills…</p>}
    {!loading && skills.length === 0 && <p className="footnote">Este build no trae skills.</p>}
    <div className="skill-list">
      {skills.map(skill => <div key={skill.id} className={'skill-card' + (skill.enabled ? ' on' : '')}>
        <Sparkles size={17} />
        <div>
          <strong>{skill.name}<small>{skill.enabled ? 'Activa' : 'Apagada'}</small></strong>
          <p>{skill.summary}</p>
        </div>
        <button aria-pressed={skill.enabled} disabled={busy === skill.id} onClick={() => void toggle(skill)}>
          {skill.enabled ? 'Apagar' : 'Activar'}
        </button>
      </div>)}
    </div>
    {skills.length > 0 && <p className="footnote">Vienen activadas: la calidad de lo que escribe Latte no debería depender de que la encuentres. Se aplican al iniciar o reanudar una conversación, no a las que ya están abiertas.</p>}
  </section>;
}
