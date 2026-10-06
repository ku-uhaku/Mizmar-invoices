import type { Locale } from './locales';

/**
 * Amount in words, which Moroccan invoices are expected to carry
 * ("Arrêtée la présente facture à la somme de ...").
 *
 * Works on the decimal string, splitting major and minor units, so no float
 * rounding can change the words.
 */
export interface AmountToWordsOptions {
  currency?: string;
  /** Include the minor unit clause even when it is zero. */
  alwaysShowMinor?: boolean;
  capitalize?: boolean;
}

interface CurrencyNames {
  majorEn: [string, string];
  majorFr: [string, string];
  majorAr: [string, string];
  minorEn: [string, string];
  minorFr: [string, string];
  minorAr: [string, string];
}

const CURRENCIES: Record<string, CurrencyNames> = {
  MAD: {
    majorEn: ['dirham', 'dirhams'],
    majorFr: ['dirham', 'dirhams'],
    majorAr: ['درهم', 'دراهم'],
    minorEn: ['centime', 'centimes'],
    minorFr: ['centime', 'centimes'],
    minorAr: ['سنتيم', 'سنتيمات'],
  },
  EUR: {
    majorEn: ['euro', 'euros'],
    majorFr: ['euro', 'euros'],
    majorAr: ['يورو', 'يورو'],
    minorEn: ['cent', 'cents'],
    minorFr: ['centime', 'centimes'],
    minorAr: ['سنت', 'سنتات'],
  },
  USD: {
    majorEn: ['dollar', 'dollars'],
    majorFr: ['dollar', 'dollars'],
    majorAr: ['دولار', 'دولارات'],
    minorEn: ['cent', 'cents'],
    minorFr: ['cent', 'cents'],
    minorAr: ['سنت', 'سنتات'],
  },
};

export function amountToWords(
  value: string,
  locale: Locale,
  options: AmountToWordsOptions = {},
): string {
  const currency = (options.currency ?? 'MAD').toUpperCase();
  const names = CURRENCIES[currency];

  const negative = value.trim().startsWith('-');
  const [wholeRaw = '0', fractionRaw = ''] = value.replace('-', '').split('.');
  const major = BigInt(wholeRaw || '0');
  const minor = Number((fractionRaw + '00').slice(0, 2));

  const words = (() => {
    switch (locale) {
      case 'FR':
        return composeFr(major, minor, names, options);
      case 'AR':
        return composeAr(major, minor, names, options);
      default:
        return composeEn(major, minor, names, options);
    }
  })();

  const prefixed = negative
    ? locale === 'FR'
      ? `moins ${words}`
      : locale === 'AR'
        ? `سالب ${words}`
        : `minus ${words}`
    : words;

  return options.capitalize === false
    ? prefixed
    : prefixed.charAt(0).toUpperCase() + prefixed.slice(1);
}

// ---------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------

const EN_ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES: Array<[bigint, string]> = [
  [1_000_000_000n, 'billion'],
  [1_000_000n, 'million'],
  [1_000n, 'thousand'],
];

function enUnderThousand(n: number): string {
  if (n < 20) return EN_ONES[n]!;
  if (n < 100) {
    const tens = EN_TENS[Math.floor(n / 10)]!;
    const ones = n % 10;
    return ones ? `${tens}-${EN_ONES[ones]}` : tens;
  }
  const hundreds = `${EN_ONES[Math.floor(n / 100)]} hundred`;
  const rest = n % 100;
  return rest ? `${hundreds} and ${enUnderThousand(rest)}` : hundreds;
}

function enInteger(value: bigint): string {
  if (value === 0n) return 'zero';
  const parts: string[] = [];
  let remaining = value;

  for (const [scale, name] of EN_SCALES) {
    if (remaining >= scale) {
      const count = remaining / scale;
      parts.push(`${enInteger(count)} ${name}`);
      remaining %= scale;
    }
  }
  if (remaining > 0n) {
    parts.push(enUnderThousand(Number(remaining)));
  }
  return parts.join(' ');
}

function composeEn(
  major: bigint,
  minor: number,
  names: CurrencyNames | undefined,
  options: AmountToWordsOptions,
): string {
  const majorUnit = names ? pick(names.majorEn, major) : (options.currency ?? '');
  const head = `${enInteger(major)}${majorUnit ? ` ${majorUnit}` : ''}`;
  if (minor === 0 && !options.alwaysShowMinor) return head;
  const minorUnit = names ? pick(names.minorEn, BigInt(minor)) : '';
  return `${head} and ${enInteger(BigInt(minor))}${minorUnit ? ` ${minorUnit}` : ''}`;
}

// ---------------------------------------------------------------------------
// French — including the soixante-dix / quatre-vingts irregularities
// ---------------------------------------------------------------------------

const FR_ONES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
];

function frUnderHundred(n: number): string {
  if (n < 17) return FR_ONES[n]!;
  if (n < 20) return `dix-${FR_ONES[n - 10]}`;

  const tens = Math.floor(n / 10);
  const ones = n % 10;

  // 70-79 and 90-99 are built on soixante and quatre-vingt in French.
  if (tens === 7 || tens === 9) {
    const base = tens === 7 ? 'soixante' : 'quatre-vingt';
    const remainder = n - (tens === 7 ? 60 : 80);
    if (remainder === 11 && tens === 7) return 'soixante et onze';
    return `${base}-${frUnderHundred(remainder)}`;
  }

  const tensWord = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', '', 'quatre-vingts'][
    tens
  ]!;

  if (ones === 0) return tensWord;
  // "vingt et un", but "quatre-vingt-un" (no "et", and no final s).
  if (ones === 1 && tens !== 8) return `${tensWord} et un`;
  if (tens === 8) return `quatre-vingt-${FR_ONES[ones]}`;
  return `${tensWord}-${FR_ONES[ones]}`;
}

function frUnderThousand(n: number): string {
  if (n < 100) return frUnderHundred(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  // "cent" is invariable alone, "deux cents" takes an s only with nothing after.
  const head =
    hundreds === 1 ? 'cent' : `${FR_ONES[hundreds]} cent${rest === 0 ? 's' : ''}`;
  return rest ? `${head} ${frUnderHundred(rest)}` : head;
}

function frInteger(value: bigint): string {
  if (value === 0n) return 'zéro';

  const parts: string[] = [];
  let remaining = value;

  for (const [scale, singular, plural] of [
    [1_000_000_000n, 'milliard', 'milliards'],
    [1_000_000n, 'million', 'millions'],
  ] as Array<[bigint, string, string]>) {
    if (remaining >= scale) {
      const count = remaining / scale;
      parts.push(`${frInteger(count)} ${count === 1n ? singular : plural}`);
      remaining %= scale;
    }
  }

  if (remaining >= 1_000n) {
    const thousands = remaining / 1_000n;
    // "mille" never takes an s, and "un mille" is just "mille".
    parts.push(thousands === 1n ? 'mille' : `${frInteger(thousands)} mille`);
    remaining %= 1_000n;
  }

  if (remaining > 0n) parts.push(frUnderThousand(Number(remaining)));
  return parts.join(' ');
}

function composeFr(
  major: bigint,
  minor: number,
  names: CurrencyNames | undefined,
  options: AmountToWordsOptions,
): string {
  const majorUnit = names ? pick(names.majorFr, major) : (options.currency ?? '');
  const head = `${frInteger(major)}${majorUnit ? ` ${majorUnit}` : ''}`;
  if (minor === 0 && !options.alwaysShowMinor) return head;
  const minorUnit = names ? pick(names.minorFr, BigInt(minor)) : '';
  return `${head} et ${frInteger(BigInt(minor))}${minorUnit ? ` ${minorUnit}` : ''}`;
}

// ---------------------------------------------------------------------------
// Arabic
// ---------------------------------------------------------------------------

const AR_ONES = [
  '', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
  'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = [
  '', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة',
  'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة',
];

function arUnderThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  if (hundreds > 0) parts.push(AR_HUNDREDS[hundreds]!);

  if (rest > 0) {
    if (rest < 20) parts.push(AR_ONES[rest]!);
    else {
      const ones = rest % 10;
      const tens = AR_TENS[Math.floor(rest / 10)]!;
      // Arabic says the unit before the ten: "خمسة وعشرون" (five and twenty).
      parts.push(ones > 0 ? `${AR_ONES[ones]} و${tens}` : tens);
    }
  }

  return parts.join(' و');
}

function arInteger(value: bigint): string {
  if (value === 0n) return 'صفر';

  const groups: Array<[bigint, string, string, string]> = [
    [1_000_000_000n, 'مليار', 'ملياران', 'مليارات'],
    [1_000_000n, 'مليون', 'مليونان', 'ملايين'],
    [1_000n, 'ألف', 'ألفان', 'آلاف'],
  ];

  const parts: string[] = [];
  let remaining = value;

  for (const [scale, singular, dual, plural] of groups) {
    if (remaining < scale) continue;
    const count = remaining / scale;
    remaining %= scale;

    // Arabic has a dual form, and 3-10 take the plural with the number before it.
    if (count === 1n) parts.push(singular);
    else if (count === 2n) parts.push(dual);
    else if (count <= 10n) parts.push(`${arUnderThousand(Number(count))} ${plural}`);
    else parts.push(`${arInteger(count)} ${singular}`);
  }

  if (remaining > 0n) parts.push(arUnderThousand(Number(remaining)));
  return parts.join(' و');
}

function composeAr(
  major: bigint,
  minor: number,
  names: CurrencyNames | undefined,
  options: AmountToWordsOptions,
): string {
  const majorUnit = names ? pick(names.majorAr, major) : (options.currency ?? '');
  const head = `${arInteger(major)}${majorUnit ? ` ${majorUnit}` : ''}`;
  if (minor === 0 && !options.alwaysShowMinor) return head;
  const minorUnit = names ? pick(names.minorAr, BigInt(minor)) : '';
  return `${head} و${arInteger(BigInt(minor))}${minorUnit ? ` ${minorUnit}` : ''}`;
}

/** Singular for exactly one, plural otherwise (including zero). */
function pick(forms: [string, string], count: bigint): string {
  return count === 1n ? forms[0] : forms[1];
}
