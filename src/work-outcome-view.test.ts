import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { MessageKey } from './i18n';

// `translate` follows the language the provider last rendered with. Here the
// test picks it, with no provider and no DOM: the markup is rendered to a string.
const ui = vi.hoisted(() => ({ locale: 'es-AR' as 'es-AR' | 'en-US' }));
vi.mock('./i18n', async (importOriginal) => {
  const real = await importOriginal<typeof import('./i18n')>();
  return { ...real, translate: (key: MessageKey, params?: Record<string, string | number>) => real.formatMessage(ui.locale, key, params) };
});

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
vi.stubGlobal('window', {});
const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { WorkOutcomeView } = await import('./WorkOutcome');
const { formatMessage } = await import('./i18n');

type ViewProps = Parameters<typeof WorkOutcomeView>[0];
const base: ViewProps = {
  expected: '', linked: null, linkedPresent: false, linkedMissing: false, listed: true, files: ['propuesta.pdf'],
  draft: { expectedOutput: '', resultPath: '' }, picked: null, editing: false, dirty: false, saving: false, busy: false, desktop: true,
  onToggle: () => {}, onChange: () => {}, onOpen: () => {}, onRefresh: () => {}, onSave: () => {},
};

function render(locale: 'es-AR' | 'en-US', props: Partial<ViewProps>): string {
  ui.locale = locale;
  return renderToStaticMarkup(createElement(WorkOutcomeView, { ...base, ...props }));
}

/** Every state the bar and its form can show: closed and open, desktop and preview, a link that is there and one that is gone. */
const everyState = (locale: 'es-AR' | 'en-US'): string => [
  render(locale, { linked: 'propuesta.pdf', linkedPresent: true, dirty: true }),
  render(locale, { linked: 'vieja.pdf', linkedMissing: true }),
  render(locale, { editing: true, dirty: true, draft: { expectedOutput: '', resultPath: 'vieja.pdf' } }),
  render(locale, { editing: true, desktop: false }),
].join('\n');

describe('Expected output of a work, in both interface languages', () => {
  it('speaks Spanish from the catalog, labels, aria and placeholder included', () => {
    const html = everyState('es-AR');
    for (const text of [
      'aria-label="Resultado esperado del trabajo"', '<strong>Resultado esperado</strong>', '<em>sin definir</em>',
      'aria-label="Abrir propuesta.pdf"', 'title="Abrir con la aplicación del sistema"', 'Editar · Sin guardar',
      'title="vieja.pdf ya no está en entregables/"', 'vieja.pdf · no está en entregables/',
      'Qué tiene que entregar este trabajo', 'placeholder="Ej. Un PDF de dos páginas con la propuesta para el cliente."',
      'aria-label="Entregable vinculado"', '>Sin vincular<', 'vieja.pdf (no está en entregables/)',
      'aria-label="Abrir el entregable elegido"', 'aria-label="Actualizar la lista de entregables"', 'Cerrar · Sin guardar',
      'Vincular un entregable requiere la aplicación de escritorio.', 'El brief sigue siendo el objetivo.', '>Guardar<',
    ]) expect(html).toContain(text);
  });

  it('renders the same states in English, with nothing left in Spanish', () => {
    const html = everyState('en-US');
    for (const text of [
      'aria-label="Expected output of this work"', '<strong>Expected output</strong>', '<em>not set</em>',
      'aria-label="Open propuesta.pdf"', 'title="Open with the system app"', 'Edit · Unsaved',
      'title="vieja.pdf is no longer in entregables/"', 'vieja.pdf · not in entregables/',
      'What this work has to deliver', 'placeholder="E.g. A two-page PDF with the proposal for the client."',
      'aria-label="Linked deliverable"', '>Not linked<', 'vieja.pdf (not in entregables/)',
      'aria-label="Open the chosen deliverable"', 'aria-label="Refresh the deliverables list"', 'Close · Unsaved',
      'Linking a deliverable requires the desktop app.', 'The brief is still the goal.', '>Save<',
    ]) expect(html).toContain(text);
    for (const spanish of ['Resultado', 'sin definir', 'Editar', 'Sin guardar', 'Abrir', 'Entregable', 'Sin vincular', 'Actualizar', 'Guardar', 'Cerrar', 'Ej.', 'no está', 'escritorio', 'objetivo']) {
      expect(html).not.toContain(spanish);
    }
  });

  it('announces a save in the interface language and leaves no literal copy in the component', () => {
    expect(formatMessage('es-AR', 'outcome.saved')).toBe('Resultado esperado guardado.');
    expect(formatMessage('en-US', 'outcome.saved')).toBe('Expected output saved.');
    const source = readFileSync(new URL('./WorkOutcome.tsx', import.meta.url), 'utf8');
    expect(source).toContain("onNotice(t('outcome.saved'))");
    // No attribute a screen reader or a tooltip reads is a literal, and no notice or error is either.
    expect(source).not.toMatch(/\b(?:aria-label|title|placeholder)="/);
    expect(source).not.toMatch(/on(?:Notice|Error)\(\s*['"`]/);
  });
});
