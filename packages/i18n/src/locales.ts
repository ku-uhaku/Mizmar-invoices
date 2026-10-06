export const LOCALES = ['EN', 'FR', 'AR'] as const;
export type Locale = (typeof LOCALES)[number];

export type Direction = 'ltr' | 'rtl';

/** Arabic documents mirror the whole layout, not just the text. */
export function directionFor(locale: Locale): Direction {
  return locale === 'AR' ? 'rtl' : 'ltr';
}

export const BCP47: Record<Locale, string> = {
  EN: 'en',
  FR: 'fr-MA',
  AR: 'ar-MA',
};
