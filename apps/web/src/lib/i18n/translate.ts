import type { Locale } from '@mizmar/i18n';
import { AR } from './messages/ar';
import { EN } from './messages/en';
import { AR_COMMON } from './messages/common.ar';
import { EN_COMMON } from './messages/common.en';
import { AR_CONTACTS } from './messages/contacts.ar';
import { EN_CONTACTS } from './messages/contacts.en';
import { AR_STOCK } from './messages/stock.ar';
import { EN_STOCK } from './messages/stock.en';
import { AR_SETTINGS } from './messages/settings.ar';
import { EN_SETTINGS } from './messages/settings.en';

export type TParams = Record<string, string | number>;

// Area files first, the base catalogue last: the base wording wins on a clash.
const DICTIONARIES: Record<Locale, Record<string, string>> = {
  FR: {},
  EN: { ...EN_COMMON, ...EN_CONTACTS, ...EN_SETTINGS, ...EN_STOCK, ...EN },
  AR: { ...AR_COMMON, ...AR_CONTACTS, ...AR_SETTINGS, ...AR_STOCK, ...AR },
};

export function translateUi(locale: Locale, fr: string, params?: TParams): string {
  const text = DICTIONARIES[locale][fr] ?? fr;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
