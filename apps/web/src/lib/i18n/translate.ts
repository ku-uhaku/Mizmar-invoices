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
import { AR_EXPENSES } from './messages/expenses.ar';
import { AR_REPORTS } from './messages/reports.ar';
import { AR_PRODUCT_IMAGES } from './messages/product-images.ar';
import { AR_HR } from './messages/hr.ar';
import { AR_PAYROLL } from './messages/payroll.ar';
import { AR_PAYMENTS } from './messages/payments.ar';
import { EN_PAYMENTS } from './messages/payments.en';
import { AR_CASH } from './messages/cash.ar';
import { AR_LOTS } from './messages/lots.ar';
import { EN_LOTS } from './messages/lots.en';
import { AR_ACCOUNTING } from './messages/accounting.ar';
import { EN_ACCOUNTING } from './messages/accounting.en';
import { AR_BANK } from './messages/bank.ar';
import { EN_BANK } from './messages/bank.en';
import { AR_PAYABLES } from './messages/payables.ar';
import { EN_PAYABLES } from './messages/payables.en';
import { AR_TREASURY } from './messages/treasury.ar';
import { EN_TREASURY } from './messages/treasury.en';
import { AR_POS } from './messages/pos.ar';
import { EN_EXPENSES } from './messages/expenses.en';
import { EN_REPORTS } from './messages/reports.en';
import { EN_PRODUCT_IMAGES } from './messages/product-images.en';
import { EN_HR } from './messages/hr.en';
import { EN_PAYROLL } from './messages/payroll.en';
import { EN_CASH } from './messages/cash.en';
import { EN_POS } from './messages/pos.en';

export type TParams = Record<string, string | number>;

// Area files first, the base catalogue last: the base wording wins on a clash.
const DICTIONARIES: Record<Locale, Record<string, string>> = {
  FR: {},
  EN: { ...EN_AUTH, ...EN_AUDIT, ...EN_IMPORT, ...EN_RECEIVABLES, ...EN_PRICING, ...EN_RECURRING, ...EN_POS, ...EN_EXPENSES, ...EN_REPORTS, ...EN_HR, ...EN_PAYROLL, ...EN_CASH, ...EN_LOTS, ...EN_ACCOUNTING, ...EN_BANK, ...EN_PAYABLES, ...EN_TREASURY, ...EN_PAYMENTS, ...EN_PRODUCT_IMAGES, ...EN_COMMON, ...EN_CONTACTS, ...EN_SETTINGS, ...EN_STOCK, ...EN },
  AR: { ...AR_AUTH, ...AR_AUDIT, ...AR_IMPORT, ...AR_RECEIVABLES, ...AR_PRICING, ...AR_RECURRING, ...AR_POS, ...AR_EXPENSES, ...AR_REPORTS, ...AR_HR, ...AR_PAYROLL, ...AR_CASH, ...AR_LOTS, ...AR_ACCOUNTING, ...AR_BANK, ...AR_PAYABLES, ...AR_TREASURY, ...AR_PAYMENTS, ...AR_PRODUCT_IMAGES, ...AR_COMMON, ...AR_CONTACTS, ...AR_SETTINGS, ...AR_STOCK, ...AR },
};

export function translateUi(locale: Locale, fr: string, params?: TParams): string {
  const text = DICTIONARIES[locale][fr] ?? fr;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
