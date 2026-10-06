import { cookies } from 'next/headers';
import type { Locale } from '@mizmar/i18n';
import { LOCALE_COOKIE, parseLocale } from './locale';

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}
