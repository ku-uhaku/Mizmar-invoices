import { BCP47, type Locale } from './locales';

export interface NumberFormatOptions {
  decimalSeparator?: ',' | '.';
  thousandsSeparator?: ' ' | ',' | '.' | '';
  /** Render 0-9 as ٠-٩, which some Moroccan documents still prefer. */
  arabicIndicDigits?: boolean;
  decimals?: number;
}

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toArabicIndic(text: string): string {
  return text.replace(/[0-9]/g, (digit) => ARABIC_INDIC[Number(digit)]!);
}

/**
 * Format a decimal *string* for display.
 *
 * Takes a string, not a number: the value arrives from Postgres NUMERIC as a
 * string and must not round-trip through a float on its way to the page.
 */
export function formatNumber(value: string, options: NumberFormatOptions = {}): string {
  const decimals = options.decimals ?? 2;
  const decimalSeparator = options.decimalSeparator ?? ',';
  const thousandsSeparator = options.thousandsSeparator ?? ' ';

  const negative = value.trim().startsWith('-');
  const [rawWhole = '0', rawFraction = ''] = value.replace('-', '').split('.');

  // Round at the display boundary without touching the underlying value.
  const rounded = roundDecimalString(rawWhole, rawFraction, decimals);
  const grouped = rounded.whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u0000');
  const whole = thousandsSeparator
    ? grouped.replace(/\u0000/g, thousandsSeparator)
    : grouped.replace(/\u0000/g, '');

  const text =
    decimals > 0
      ? `${negative ? '-' : ''}${whole}${decimalSeparator}${rounded.fraction}`
      : `${negative ? '-' : ''}${whole}`;

  return options.arabicIndicDigits ? toArabicIndic(text) : text;
}

/** Half-up rounding on the digit strings, so no float is ever involved. */
function roundDecimalString(
  whole: string,
  fraction: string,
  decimals: number,
): { whole: string; fraction: string } {
  const padded = fraction.padEnd(decimals + 1, '0');
  const kept = padded.slice(0, decimals);
  const next = Number(padded[decimals] ?? '0');

  if (next < 5) return { whole, fraction: kept };

  // Carry into the integer part by string addition.
  const bumped = (BigInt(whole + kept.padEnd(decimals, '0') || '0') + 1n).toString();
  const padBumped = bumped.padStart(decimals + 1, '0');
  return {
    whole: decimals > 0 ? padBumped.slice(0, -decimals) : padBumped,
    fraction: decimals > 0 ? padBumped.slice(-decimals) : '',
  };
}

export interface MoneyFormatOptions extends NumberFormatOptions {
  currency: string;
  symbolPosition?: 'BEFORE' | 'AFTER';
  /** Omit the currency entirely, for a column that has it in its header. */
  hideCurrency?: boolean;
}

export function formatMoney(value: string, options: MoneyFormatOptions): string {
  const amount = formatNumber(value, options);
  if (options.hideCurrency) return amount;
  const symbol = currencySymbol(options.currency);
  return (options.symbolPosition ?? 'AFTER') === 'BEFORE'
    ? `${symbol} ${amount}`
    : `${amount} ${symbol}`;
}

const SYMBOLS: Record<string, string> = {
  MAD: 'DH',
  EUR: '€',
  USD: '$',
  GBP: '£',
};

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency.toUpperCase()] ?? currency.toUpperCase();
}

export type DateFormat = 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'MM/DD/YYYY';

/**
 * Format an ISO date with an explicit pattern.
 *
 * Deliberately not `Intl.DateTimeFormat`: a document's date format is a
 * company setting the user picked, and must not shift with the server's locale
 * or ICU version.
 */
export function formatDate(
  isoDate: string,
  pattern: DateFormat = 'DD/MM/YYYY',
  options: { arabicIndicDigits?: boolean } = {},
): string {
  const [year = '', month = '', day = ''] = isoDate.slice(0, 10).split('-');
  const text = (() => {
    switch (pattern) {
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`;
      case 'DD-MM-YYYY':
        return `${day}-${month}-${year}`;
      case 'MM/DD/YYYY':
        return `${month}/${day}/${year}`;
      default:
        return `${day}/${month}/${year}`;
    }
  })();
  return options.arabicIndicDigits ? toArabicIndic(text) : text;
}

export function formatDateLong(isoDate: string, locale: Locale): string {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString(BCP47[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
