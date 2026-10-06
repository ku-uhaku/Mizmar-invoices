import Decimal from 'decimal.js';

// Wide working precision; we only ever round at explicit boundaries.
Decimal.set({ precision: 34, toExpNeg: -30, toExpPos: 30 });

export { Decimal };

/** Anything we accept as a money/quantity input. Never a float that came from arithmetic. */
export type Numeric = string | number | Decimal;

export type RoundingMode = 'HALF_UP' | 'HALF_DOWN' | 'HALF_EVEN' | 'UP' | 'DOWN';

/**
 * How a company wants money rounded.
 * `granularity: 'LINE'` rounds every line total before summing (the common
 * European/Moroccan invoice convention). `'DOCUMENT'` keeps full precision per
 * line and rounds only the document totals.
 */
export interface RoundingConfig {
  mode: RoundingMode;
  scale: number;
  granularity: 'LINE' | 'DOCUMENT';
}

export const DEFAULT_ROUNDING: RoundingConfig = {
  mode: 'HALF_UP',
  scale: 2,
  granularity: 'LINE',
};

const DECIMAL_ROUNDING: Record<RoundingMode, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_DOWN: Decimal.ROUND_HALF_DOWN,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  UP: Decimal.ROUND_CEIL,
  DOWN: Decimal.ROUND_FLOOR,
};

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
export const HUNDRED = new Decimal(100);

/** Coerce to Decimal. `null`/`undefined`/`''` all mean zero. */
export function dec(value: Numeric | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return ZERO;
  if (value instanceof Decimal) return value;
  return new Decimal(value);
}

export function round(value: Numeric, config: RoundingConfig = DEFAULT_ROUNDING): Decimal {
  return dec(value).toDecimalPlaces(config.scale, DECIMAL_ROUNDING[config.mode]);
}

/** Round only when the company rounds per line. */
export function roundLine(value: Numeric, config: RoundingConfig): Decimal {
  return config.granularity === 'LINE' ? round(value, config) : dec(value);
}

export function sum(values: Decimal[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), ZERO);
}

/** Serialise for storage/transport. Always a fixed-scale decimal string, never a float. */
export function money(value: Numeric, config: RoundingConfig = DEFAULT_ROUNDING): string {
  return round(value, config).toFixed(config.scale);
}

export function isZero(value: Numeric): boolean {
  return dec(value).isZero();
}

export function eq(a: Numeric, b: Numeric): boolean {
  return dec(a).eq(dec(b));
}

export function maxOf(a: Numeric, b: Numeric): Decimal {
  const da = dec(a);
  const db = dec(b);
  return da.gte(db) ? da : db;
}

export function minOf(a: Numeric, b: Numeric): Decimal {
  const da = dec(a);
  const db = dec(b);
  return da.lte(db) ? da : db;
}

/**
 * Split `total` across `weights` so the parts sum to exactly `total` at the
 * configured scale, using the largest-remainder method.
 *
 * This is what keeps a global discount honest: naively rounding each share
 * independently loses or invents centimes, and the VAT buckets then disagree
 * with the document total. The remainder is handed to the lines with the
 * largest discarded fraction, so the sum is exact by construction.
 */
export function allocate(
  total: Numeric,
  weights: Numeric[],
  config: RoundingConfig = DEFAULT_ROUNDING,
): Decimal[] {
  const target = dec(total);
  if (weights.length === 0) return [];
  if (target.isZero()) return weights.map(() => ZERO);

  const sign = target.isNegative() ? -1 : 1;
  const absTarget = target.abs();
  const ws = weights.map((w) => dec(w));
  const weightSum = sum(ws);

  // No basis for a proportional split (e.g. every line is free): put it all on
  // the first line rather than silently dropping it.
  if (weightSum.isZero()) {
    return ws.map((_, i) =>
      i === 0 ? round(absTarget, config).times(sign) : ZERO,
    );
  }

  const step = new Decimal(10).pow(-config.scale);
  const floors: Decimal[] = [];
  const fractions: Decimal[] = [];

  for (const w of ws) {
    const exact = absTarget.times(w).div(weightSum);
    const floored = exact.toDecimalPlaces(config.scale, Decimal.ROUND_FLOOR);
    floors.push(floored);
    fractions.push(exact.minus(floored));
  }

  let remainder = absTarget.minus(sum(floors));
  const increments = remainder.div(step).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  const order = fractions
    .map((f, i) => ({ i, f }))
    .sort((a, b) => (b.f.eq(a.f) ? a.i - b.i : b.f.minus(a.f).toNumber()));

  for (let n = 0; n < increments; n += 1) {
    const slot = order[n % order.length];
    if (!slot) break;
    floors[slot.i] = (floors[slot.i] ?? ZERO).plus(step);
  }

  return floors.map((f) => f.times(sign));
}
