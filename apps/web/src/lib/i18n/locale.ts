import type { Locale } from '@mizmar/i18n';

/** Shared by the server (reads it to render `<html dir>`) and the switcher (writes it). */
export const LOCALE_COOKIE = 'mz_locale';
export const DEFAULT_LOCALE: Locale = 'FR';

export function parseLocale(value: string | null | undefined): Locale {
  const upper = value?.toUpperCase();
  return upper === 'EN' || upper === 'FR' || upper === 'AR' ? upper : DEFAULT_LOCALE;
}

export const LOCALE_NAMES: Record<Locale, string> = {
  FR: 'Français',
  EN: 'English',
  AR: 'العربية',
};
