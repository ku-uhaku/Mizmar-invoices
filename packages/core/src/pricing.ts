import { Decimal, ONE, dec, round, type Numeric, type RoundingConfig } from './money';

/**
 * Pure pricing and currency helpers. No I/O: the API loads rows and hands them
 * in, so precedence and conversion are testable without a database.
 *
 * Conventions
 * - Dates are ISO `YYYY-MM-DD` strings (lexicographic order == chronological).
 * - A rate `{ base: 'EUR', quote: 'MAD', rate: 10.8 }` means 1 EUR = 10.8 MAD.
 * - `Document.exchangeRate` is the rate from the document currency to the
 *   company (base) currency, i.e. `totalBase = total * exchangeRate`.
 * - Unit prices are stored at scale 6 (NUMERIC(18,6)); money totals use the
 *   company rounding config.
 */

export const UNIT_PRICE_SCALE = 6;

/** `YYYY-MM-DD` of a Date (UTC), the form every date in this module uses. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface RateRow {
  base: string;
  quote: string;
  rate: Numeric;
  validFrom: string;
}

export interface ResolvedRate {
  rate: Decimal;
  /** Date of the rate row used (null for identity). */
  validFrom: string | null;
  /** True when derived as 1 / rate of the reverse pair. */
  inverted: boolean;
}

/** 1 / rate, kept at high precision; never rounded to money scale. */
export function invertRate(rate: Numeric): Decimal {
  const r = dec(rate);
  if (r.lte(0)) throw new RangeError('Exchange rate must be positive');
  return ONE.div(r);
}

/**
 * Convert an amount between currencies and round to `scale` (default: unit
 * price scale). Pass the company rounding config to convert money amounts.
 */
export function convertAmount(
  amount: Numeric,
  rate: Numeric,
  rounding: Pick<RoundingConfig, 'mode' | 'scale'> = { mode: 'HALF_UP', scale: UNIT_PRICE_SCALE },
): Decimal {
  const r = dec(rate);
  if (r.lte(0)) throw new RangeError('Exchange rate must be positive');
  return round(dec(amount).times(r), {
    mode: rounding.mode,
    scale: rounding.scale,
    granularity: 'LINE',
  });
}

/** Total in the company currency, for reporting. */
export function toBaseAmount(
  amount: Numeric,
  documentRate: Numeric,
  rounding: RoundingConfig,
): Decimal {
  return convertAmount(amount, documentRate, rounding);
}

/**
 * Find the rate for `from -> to` at `date`: the most recent rate valid on or
 * before `date`; when only the reverse pair exists it is inverted. If both
 * directions exist the more recent one wins (direct on ties). Returns null when
 * nothing applies. Identity (same currency) is always 1.
 */
export function resolveRate(
  rates: readonly RateRow[],
  from: string,
  to: string,
  date: string,
): ResolvedRate | null {
  if (from === to) return { rate: ONE, validFrom: null, inverted: false };

  const latest = (base: string, quote: string): RateRow | null => {
    let best: RateRow | null = null;
    for (const row of rates) {
      if (row.base !== base || row.quote !== quote || row.validFrom > date) continue;
      if (!best || row.validFrom > best.validFrom) best = row;
    }
    return best;
  };

  const direct = latest(from, to);
  const reverse = latest(to, from);
  if (direct && (!reverse || direct.validFrom >= reverse.validFrom)) {
    return { rate: dec(direct.rate), validFrom: direct.validFrom, inverted: false };
  }
  if (reverse) {
    return { rate: invertRate(reverse.rate), validFrom: reverse.validFrom, inverted: true };
  }
  return null;
}

export interface PriceTier {
  price: Numeric;
  minQuantity: Numeric;
  discountPercent?: Numeric | null;
}

/** The tier with the highest minQuantity that does not exceed `quantity`. */
export function pickTier<T extends PriceTier>(tiers: readonly T[], quantity: Numeric): T | null {
  const qty = dec(quantity);
  let best: T | null = null;
  for (const tier of tiers) {
    const min = dec(tier.minQuantity);
    if (min.gt(qty)) continue;
    if (!best || min.gt(dec(best.minQuantity))) best = tier;
  }
  return best;
}

export interface PriceListLike {
  id: string;
  currency: string;
  isActive: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  /** Items for the variant being priced only. */
  tiers: readonly PriceTier[];
}

export function isListValidOn(
  list: Pick<PriceListLike, 'isActive' | 'validFrom' | 'validTo'>,
  date: string,
): boolean {
  if (!list.isActive) return false;
  if (list.validFrom && date < list.validFrom) return false;
  if (list.validTo && date > list.validTo) return false;
  return true;
}

export type PriceSource = 'CONTACT_LIST' | 'DEFAULT_LIST' | 'BASE';

export interface PriceSelection {
  source: PriceSource;
  priceListId: string | null;
  /** Price in `currency`, before conversion. */
  price: Decimal;
  currency: string;
  discountPercent: Decimal | null;
  minQuantity: Decimal | null;
}

/**
 * Documented precedence (first hit wins):
 *  1. the contact's price list, if active, valid on `date` and it has a tier
 *     for the variant whose minQuantity <= quantity;
 *  2. the company's default price list, same conditions;
 *  3. the variant's base selling price, in the company currency.
 * A list that is invalid or has no matching tier is skipped (falls through).
 */
export function selectPrice(input: {
  contactList?: PriceListLike | null;
  defaultList?: PriceListLike | null;
  basePrice: Numeric;
  baseCurrency: string;
  quantity: Numeric;
  date: string;
}): PriceSelection {
  const attempts: Array<[PriceSource, PriceListLike | null | undefined]> = [
    ['CONTACT_LIST', input.contactList],
    ['DEFAULT_LIST', input.defaultList],
  ];
  for (const [source, list] of attempts) {
    if (!list || !isListValidOn(list, input.date)) continue;
    const tier = pickTier(list.tiers, input.quantity);
    if (!tier) continue;
    return {
      source,
      priceListId: list.id,
      price: dec(tier.price),
      currency: list.currency,
      discountPercent: tier.discountPercent == null ? null : dec(tier.discountPercent),
      minQuantity: dec(tier.minQuantity),
    };
  }
  return {
    source: 'BASE',
    priceListId: null,
    price: dec(input.basePrice),
    currency: input.baseCurrency,
    discountPercent: null,
    minQuantity: null,
  };
}
