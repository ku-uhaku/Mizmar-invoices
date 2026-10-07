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
import { AR_AUTH } from './messages/auth.ar';
import { EN_AUTH } from './messages/auth.en';
import { AR_AUDIT } from './messages/audit.ar';
import { EN_AUDIT } from './messages/audit.en';
import { AR_IMPORT } from './messages/import.ar';
import { EN_IMPORT } from './messages/import.en';
import { AR_RECEIVABLES } from './messages/receivables.ar';
import { EN_RECEIVABLES } from './messages/receivables.en';
import { AR_PRICING } from './messages/pricing.ar';
import { EN_PRICING } from './messages/pricing.en';
import { AR_RECURRING } from './messages/recurring.ar';
import { EN_RECURRING } from './messages/recurring.en';

export type TParams = Record<string, string | number>;

// Area files first, the base catalogue last: the base wording wins on a clash.
const DICTIONARIES: Record<Locale, Record<string, string>> = {
  FR: {},
  EN: { ...EN_AUTH, ...EN_AUDIT, ...EN_IMPORT, ...EN_RECEIVABLES, ...EN_PRICING, ...EN_RECURRING, ...EN_COMMON, ...EN_CONTACTS, ...EN_SETTINGS, ...EN_STOCK, ...EN },
  AR: { ...AR_AUTH, ...AR_AUDIT, ...AR_IMPORT, ...AR_RECEIVABLES, ...AR_PRICING, ...AR_RECURRING, ...AR_COMMON, ...AR_CONTACTS, ...AR_SETTINGS, ...AR_STOCK, ...AR },
};

export function translateUi(locale: Locale, fr: string, params?: TParams): string {
  const text = DICTIONARIES[locale][fr] ?? fr;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
