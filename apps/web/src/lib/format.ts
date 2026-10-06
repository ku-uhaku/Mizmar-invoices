import {
  formatDate,
  formatMoney,
  formatNumber,
  translate,
  type Locale,
  type MessageKey,
} from '@mizmar/i18n';
import { translateUi } from './i18n/translate';

/**
 * Display formatting for the UI.
 *
 * The app is French-first (the market it is built for), with the same message
 * catalogue the printed documents use, so a badge reads the same on screen and
 * on paper.
 */
let UI_LOCALE: Locale = 'FR';

/** Set by the I18nProvider; the formatters below are plain functions, not hooks. */
export function setUiLocale(locale: Locale): void {
  UI_LOCALE = locale;
}

/** Latin digits in every language (the Moroccan convention); only the separators differ. */
const NUMBER_OPTIONS = {
  get decimalSeparator(): ',' | '.' {
    return UI_LOCALE === 'EN' ? '.' : ',';
  },
  get thousandsSeparator(): ' ' | ',' {
    return UI_LOCALE === 'EN' ? ',' : ' ';
  },
};

export function money(value: string | null | undefined, currency = 'MAD'): string {
  if (value === null || value === undefined) return '—';
  return formatMoney(value, { ...NUMBER_OPTIONS, currency, symbolPosition: 'AFTER', decimals: 2 });
}

export function amount(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return formatNumber(value, { ...NUMBER_OPTIONS, decimals: 2 });
}

/** Quantities drop trailing zeros: "4" rather than "4.000000". */
export function qty(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const trimmed = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  const decimals = Math.min((trimmed.split('.')[1] ?? '').length, 3);
  return formatNumber(trimmed, { ...NUMBER_OPTIONS, decimals });
}

export function percent(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const decimals = (value.split('.')[1] ?? '').replace(/0+$/, '').length;
  return `${formatNumber(value, { ...NUMBER_OPTIONS, decimals: Math.min(decimals, 2) })} %`;
}

export function date(value: string | null | undefined): string {
  if (!value) return '—';
  return formatDate(value, 'DD/MM/YYYY');
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return `${formatDate(value, 'DD/MM/YYYY')} ${parsed.toTimeString().slice(0, 5)}`;
}

export function t(key: string, values?: Record<string, string | number>): string {
  try {
    return translate(UI_LOCALE, key as MessageKey, values);
  } catch {
    return key;
  }
}

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  DEVIS: 'Devis',
  SALES_ORDER: 'Bon de commande',
  DELIVERY_NOTE: 'Bon de livraison',
  SALES_INVOICE: 'Facture',
  CREDIT_NOTE: "Facture d'avoir",
  PURCHASE_ORDER: 'Commande fournisseur',
  GOODS_RECEIPT: 'Bon de réception',
  PURCHASE_INVOICE: "Facture d'achat",
};

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  OPENING_BALANCE: 'Stock initial',
  SALE: 'Vente',
  SALE_RETURN: 'Retour client',
  PURCHASE: 'Achat',
  PURCHASE_RETURN: 'Retour fournisseur',
  ADJUSTMENT: 'Ajustement',
  COUNT_CORRECTION: 'Inventaire',
  TRANSFER_OUT: 'Transfert sortant',
  TRANSFER_IN: 'Transfert entrant',
  CANCELLATION: 'Annulation',
};

export const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  DAMAGED: 'Endommagé',
  LOST: 'Perdu',
  SHRINKAGE: 'Démarque inconnue',
  EXPIRED: 'Périmé',
  FOUND: 'Retrouvé',
  COUNT_VARIANCE: 'Écart d’inventaire',
  CORRECTION: 'Correction',
  OTHER: 'Autre',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces',
  BANK_TRANSFER: 'Virement',
  CHEQUE: 'Chèque',
  BILL_OF_EXCHANGE: 'Effet',
  CARD: 'Carte',
  OTHER: 'Autre',
};

/** The label records stay French (the translation keys); these translate at render time. */
function labelOf(labels: Record<string, string>, code: string): string {
  const fr = labels[code];
  return fr ? translateUi(UI_LOCALE, fr) : code;
}

export function documentTypeLabel(type: string): string {
  return labelOf(DOCUMENT_TYPE_LABELS, type);
}

export function movementTypeLabel(type: string): string {
  return labelOf(MOVEMENT_TYPE_LABELS, type);
}

export function adjustmentReasonLabel(reason: string): string {
  return labelOf(ADJUSTMENT_REASON_LABELS, reason);
}

export function paymentMethodLabel(method: string): string {
  return labelOf(PAYMENT_METHOD_LABELS, method);
}

const DOCUMENT_TYPE_PLURAL_LABELS: Record<string, string> = {
  DEVIS: 'Devis',
  SALES_ORDER: 'Bons de commande',
  DELIVERY_NOTE: 'Bons de livraison',
  SALES_INVOICE: 'Factures',
  CREDIT_NOTE: "Factures d'avoir",
  PURCHASE_ORDER: 'Commandes fournisseur',
  GOODS_RECEIPT: 'Bons de réception',
  PURCHASE_INVOICE: "Factures d'achat",
};

export function documentTypePluralLabel(type: string): string {
  return labelOf(DOCUMENT_TYPE_PLURAL_LABELS, type);
}
