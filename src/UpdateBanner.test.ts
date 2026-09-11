import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '../shared/contracts';

vi.mock('./browser-api', () => ({ api: {} }));

const { UnsupportedUpdateNotice } = await import('./UpdateBanner');

const unsupported = (message: string): UpdateState => ({
  phase: 'unsupported',
  version: null,
  percent: 0,
  message,
});

const render = (message: string) => renderToStaticMarkup(
  createElement(UnsupportedUpdateNotice, { state: unsupported(message) }),
);

describe('UpdateBanner unsupported installations', () => {
  it('shows .deb guidance without offering an update action', () => {
    const message = 'La instalación .deb no se actualiza automáticamente. Descargá la versión nueva y reinstalá Latte.';
    const markup = render(message);

    expect(markup).toContain(message);
    expect(markup).not.toContain('<button');
  });

  it('keeps source and development unsupported states quiet', () => {
    expect(render('Estás usando Latte desde el código fuente.')).toBe('');
  });
});
