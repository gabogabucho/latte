import { describe, expect, it } from 'vitest';
import { interpolate } from './i18n-core';

describe('i18n formatter', () => {
  it('falls back safely and interpolates without evaluating input', () => {
    expect(interpolate('en-US', '{count, plural, one {# role} other {# roles}}', { count: 1 })).toBe('1 role');
    expect(interpolate('en-US', '{count, plural, one {# role} other {# roles}}', { count: 3 })).toBe('3 roles');
    expect(interpolate('es-AR', 'Hola, {name}', { name: '<script>' })).toBe('Hola, <script>');
  });
});
