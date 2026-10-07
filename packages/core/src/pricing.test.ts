import { describe, expect, it } from 'vitest';
import {
  convertAmount,
  invertRate,
  isListValidOn,
  pickTier,
  resolveRate,
  selectPrice,
  toBaseAmount,
  type PriceListLike,
  type RateRow,
} from './pricing';
import { DEFAULT_ROUNDING } from './money';

const rates: RateRow[] = [
  { base: 'EUR', quote: 'MAD', rate: '10.50', validFrom: '2026-01-01' },
  { base: 'EUR', quote: 'MAD', rate: '10.80', validFrom: '2026-06-01' },
  { base: 'USD', quote: 'MAD', rate: '10', validFrom: '2026-03-01' },
];

describe('resolveRate', () => {
  it('is identity for the same currency', () => {
    expect(resolveRate([], 'MAD', 'MAD', '2026-07-01')?.rate.toString()).toBe('1');
  });
  it('falls back to the most recent earlier rate', () => {
    expect(resolveRate(rates, 'EUR', 'MAD', '2026-05-31')?.rate.toString()).toBe('10.5');
    expect(resolveRate(rates, 'EUR', 'MAD', '2026-06-01')?.rate.toString()).toBe('10.8');
    expect(resolveRate(rates, 'EUR', 'MAD', '2026-12-31')?.validFrom).toBe('2026-06-01');
  });
  it('returns null before the first rate or for unknown pairs', () => {
    expect(resolveRate(rates, 'EUR', 'MAD', '2025-12-31')).toBeNull();
    expect(resolveRate(rates, 'GBP', 'MAD', '2026-12-31')).toBeNull();
  });
  it('inverts the reverse pair', () => {
    const r = resolveRate(rates, 'MAD', 'USD', '2026-04-01')!;
    expect(r.inverted).toBe(true);
    expect(r.rate.toString()).toBe('0.1');
  });
  it('prefers the more recent of direct and reverse', () => {
    const mixed: RateRow[] = [
      { base: 'EUR', quote: 'MAD', rate: '10', validFrom: '2026-01-01' },
      { base: 'MAD', quote: 'EUR', rate: '0.0909090909', validFrom: '2026-02-01' },
    ];
    expect(resolveRate(mixed, 'EUR', 'MAD', '2026-03-01')?.inverted).toBe(true);
    expect(resolveRate(mixed, 'EUR', 'MAD', '2026-01-15')?.inverted).toBe(false);
  });
});

describe('conversion', () => {
  it('converts and rounds to scale', () => {
    expect(convertAmount('100', '10.8').toFixed(6)).toBe('1080.000000');
    expect(convertAmount('1', invertRate('3')).toFixed(6)).toBe('0.333333');
    expect(toBaseAmount('19.99', '10.8', DEFAULT_ROUNDING).toFixed(2)).toBe('215.89');
  });
  it('honours the rounding mode', () => {
    const even = { mode: 'HALF_EVEN' as const, scale: 2, granularity: 'LINE' as const };
    const up = { mode: 'HALF_UP' as const, scale: 2, granularity: 'LINE' as const };
    expect(toBaseAmount('0.125', '1', even).toFixed(2)).toBe('0.12');
    expect(toBaseAmount('0.125', '1', up).toFixed(2)).toBe('0.13');
  });
  it('rejects non-positive rates', () => {
    expect(() => invertRate(0)).toThrow();
    expect(() => convertAmount(1, -1)).toThrow();
  });
});

describe('tiers and validity', () => {
  const tiers = [
    { price: '10', minQuantity: '0' },
    { price: '9', minQuantity: '10' },
    { price: '8', minQuantity: '100' },
  ];
  it('picks the highest tier not exceeding quantity', () => {
    expect(pickTier(tiers, 1)?.price).toBe('10');
    expect(pickTier(tiers, 10)?.price).toBe('9');
    expect(pickTier(tiers, 99.5)?.price).toBe('9');
    expect(pickTier(tiers, 500)?.price).toBe('8');
    expect(pickTier([{ price: '5', minQuantity: '5' }], 1)).toBeNull();
  });
  it('checks the validity window inclusively', () => {
    const l = { isActive: true, validFrom: '2026-02-01', validTo: '2026-02-28' };
    expect(isListValidOn(l, '2026-01-31')).toBe(false);
    expect(isListValidOn(l, '2026-02-01')).toBe(true);
    expect(isListValidOn(l, '2026-02-28')).toBe(true);
    expect(isListValidOn(l, '2026-03-01')).toBe(false);
    expect(isListValidOn({ ...l, isActive: false }, '2026-02-10')).toBe(false);
  });
});

describe('selectPrice precedence', () => {
  const list = (id: string, price: string, extra: Partial<PriceListLike> = {}): PriceListLike => ({
    id,
    currency: 'MAD',
    isActive: true,
    tiers: [{ price, minQuantity: '0' }],
    ...extra,
  });
  const base = { basePrice: '100', baseCurrency: 'MAD', quantity: 1, date: '2026-05-01' };

  it('contact list beats default list beats base', () => {
    expect(
      selectPrice({ ...base, contactList: list('c', '70'), defaultList: list('d', '80') }).source,
    ).toBe('CONTACT_LIST');
    expect(selectPrice({ ...base, defaultList: list('d', '80') })).toMatchObject({
      source: 'DEFAULT_LIST',
      priceListId: 'd',
    });
    expect(selectPrice(base)).toMatchObject({ source: 'BASE', priceListId: null });
  });
  it('skips an expired or inactive contact list', () => {
    const expired = list('c', '70', { validTo: '2026-04-30' });
    expect(
      selectPrice({ ...base, contactList: expired, defaultList: list('d', '80') }).source,
    ).toBe('DEFAULT_LIST');
    expect(selectPrice({ ...base, contactList: list('c', '70', { isActive: false }) }).source).toBe(
      'BASE',
    );
  });
  it('skips a list whose tiers do not reach the quantity', () => {
    const tiered = list('c', '70', { tiers: [{ price: '70', minQuantity: '10' }] });
    expect(
      selectPrice({ ...base, contactList: tiered, defaultList: list('d', '80') }).source,
    ).toBe('DEFAULT_LIST');
    expect(selectPrice({ ...base, quantity: 10, contactList: tiered }).price.toString()).toBe('70');
  });
  it('keeps the list currency and discount for the caller to convert', () => {
    const eur = list('c', '7', {
      currency: 'EUR',
      tiers: [{ price: '7', minQuantity: '0', discountPercent: '5' }],
    });
    const sel = selectPrice({ ...base, contactList: eur });
    expect(sel.currency).toBe('EUR');
    expect(sel.discountPercent?.toString()).toBe('5');
  });
});
