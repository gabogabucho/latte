import { translate as t } from './i18n';
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
        ? t('ui.auto.392', { p0: skill.name })
        : t('ui.auto.393', { p0: skill.name }));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  return <section className="settings-section">
    <h2>{t('ui.auto.394')}</h2>
    <p className="settings-lead">{t('ui.auto.263')}</p>
    {!isDesktop && <p className="profile-disclaimer">{t('ui.auto.264')}</p>}
    {loading && <p className="footnote">{t('ui.auto.395')}</p>}
    {!loading && skills.length === 0 && <p className="footnote">{t('ui.auto.396')}</p>}
    <div className="skill-list">
      {skills.map(skill => <div key={skill.id} className={'skill-card' + (skill.enabled ? ' on' : '')}>
        <Sparkles size={17} />
        <div>
          <strong>{skill.name}<small>{skill.enabled ? t('ui.auto.397') : t('ui.auto.398')}</small></strong>
          <p>{skill.summary}</p>
        </div>
        <button aria-pressed={skill.enabled} disabled={busy === skill.id} onClick={() => void toggle(skill)}>
          {skill.enabled ? t('ui.auto.399') : t('ui.auto.400')}
        </button>
      </div>)}
    </div>
    {skills.length > 0 && <p className="footnote">{t('ui.auto.265')}</p>}
  </section>;
}
