import { describe, expect, it } from 'vitest';
import { translateUi } from './translate';

describe('translateUi', () => {
  it('keeps the French text for FR', () => {
    expect(translateUi('FR', 'Nouveau client')).toBe('Nouveau client');
  });

  it('translates to English and Arabic', () => {
    expect(translateUi('EN', 'Nouveau client')).toBe('New client');
    expect(translateUi('AR', 'Nouveau client')).toBe('زبون جديد');
  });

  it('falls back to the French source when a key is missing', () => {
    expect(translateUi('AR', 'Texte inconnu')).toBe('Texte inconnu');
  });

  it('interpolates parameters', () => {
    expect(translateUi('EN', 'Rechercher « {q} » dans les documents', { q: 'abc' })).toBe(
      'Search “abc” in documents',
    );
  });
});
