import { describe, expect, it } from 'vitest';
import { computeTotals, type TotalsInput } from './totals';

const line = (over: Partial<TotalsInput['lines'][number]> = {}) => ({
  id: over.id ?? 'l1',
  quantity: over.quantity ?? '1',
  unitPrice: over.unitPrice ?? '100',
  vatRate: over.vatRate ?? '20',
  discount: over.discount ?? null,
  isNote: over.isNote,
});

describe('computeTotals', () => {
  it('computes a plain single-line invoice', () => {
    const r = computeTotals({ lines: [line({ quantity: '3', unitPrice: '250' })] });
    expect(r.subtotalNet).toBe('750.00');
    expect(r.totalHT).toBe('750.00');
    expect(r.totalTVA).toBe('150.00');
    expect(r.totalTTC).toBe('900.00');
  });

  it('applies a percentage line discount', () => {
    const r = computeTotals({
      lines: [line({ quantity: '10', unitPrice: '100', discount: { kind: 'PERCENT', value: '10' } })],
    });
    expect(r.subtotalGross).toBe('1000.00');
    expect(r.totalLineDiscounts).toBe('100.00');
    expect(r.totalHT).toBe('900.00');
    expect(r.totalTTC).toBe('1080.00');
  });

  it('applies a fixed-amount line discount', () => {
    const r = computeTotals({
      lines: [line({ quantity: '2', unitPrice: '50', discount: { kind: 'AMOUNT', value: '15' } })],
    });
    expect(r.totalHT).toBe('85.00');
  });

  it('never lets a discount exceed the line', () => {
    const r = computeTotals({
      lines: [line({ quantity: '1', unitPrice: '40', discount: { kind: 'AMOUNT', value: '999' } })],
    });
    expect(r.totalHT).toBe('0.00');
    expect(r.totalTTC).toBe('0.00');
  });

  it('spreads a global discount pro-rata and keeps VAT buckets consistent', () => {
    const r = computeTotals({
      lines: [
        line({ id: 'a', quantity: '1', unitPrice: '600', vatRate: '20' }),
        line({ id: 'b', quantity: '1', unitPrice: '400', vatRate: '10' }),
      ],
      globalDiscount: { kind: 'PERCENT', value: '10' },
    });

    expect(r.subtotalNet).toBe('1000.00');
    expect(r.globalDiscount).toBe('100.00');
    expect(r.totalHT).toBe('900.00');

    // The discount lands 60/40 across the two VAT rates, so neither bucket is skewed.
    expect(r.vatBuckets).toEqual([
      { rate: '20.00', base: '540.00', amount: '108.00' },
      { rate: '10.00', base: '360.00', amount: '36.00' },
    ]);
    expect(r.totalTVA).toBe('144.00');
    expect(r.totalTTC).toBe('1044.00');
  });

  it('keeps the global discount shares summing to the discount exactly', () => {
    const r = computeTotals({
      lines: Array.from({ length: 7 }, (_, i) => line({ id: `l${i}`, unitPrice: '10' })),
      globalDiscount: { kind: 'AMOUNT', value: '10.01' },
    });
    const shares = r.lines.reduce((acc, l) => acc + Number(l.globalDiscountShare), 0);
    expect(shares.toFixed(2)).toBe('10.01');
    expect(r.totalHT).toBe('59.99');
  });

  it('groups several lines at the same rate into one bucket', () => {
    const r = computeTotals({
      lines: [
        line({ id: 'a', unitPrice: '100', vatRate: '20' }),
        line({ id: 'b', unitPrice: '200', vatRate: '20' }),
        line({ id: 'c', unitPrice: '300', vatRate: '7' }),
      ],
    });
    expect(r.vatBuckets).toHaveLength(2);
    expect(r.vatBuckets[0]).toEqual({ rate: '20.00', base: '300.00', amount: '60.00' });
    expect(r.vatBuckets[1]).toEqual({ rate: '7.00', base: '300.00', amount: '21.00' });
  });

  it('adds shipping into its own VAT bucket', () => {
    const r = computeTotals({
      lines: [line({ unitPrice: '100', vatRate: '20' })],
      shipping: { amount: '50', vatRate: '14' },
    });
    expect(r.shippingNet).toBe('50.00');
    expect(r.totalHT).toBe('150.00');
    expect(r.totalTVA).toBe('27.00'); // 20 + 7
    expect(r.totalTTC).toBe('177.00');
  });

  it('converts VAT-inclusive prices to HT before discounting', () => {
    const r = computeTotals({
      lines: [line({ quantity: '1', unitPrice: '120', vatRate: '20' })],
      priceMode: 'INCLUSIVE',
    });
    expect(r.totalHT).toBe('100.00');
    expect(r.totalTVA).toBe('20.00');
    expect(r.totalTTC).toBe('120.00');
  });

  it('ignores narrative lines entirely', () => {
    const r = computeTotals({
      lines: [
        line({ id: 'head', unitPrice: '999', isNote: true }),
        line({ id: 'real', unitPrice: '100' }),
      ],
    });
    expect(r.lines).toHaveLength(1);
    expect(r.totalHT).toBe('100.00');
  });

  it('handles a zero-rated line', () => {
    const r = computeTotals({ lines: [line({ unitPrice: '100', vatRate: '0' })] });
    expect(r.totalTVA).toBe('0.00');
    expect(r.totalTTC).toBe('100.00');
  });

  it('is empty-safe', () => {
    const r = computeTotals({ lines: [] });
    expect(r.totalHT).toBe('0.00');
    expect(r.totalTTC).toBe('0.00');
    expect(r.vatBuckets).toEqual([]);
  });

  it('respects document-level rounding granularity', () => {
    const input: TotalsInput = {
      lines: [
        line({ id: 'a', quantity: '3', unitPrice: '0.335' }),
        line({ id: 'b', quantity: '3', unitPrice: '0.335' }),
      ],
      rounding: { mode: 'HALF_UP', scale: 2, granularity: 'DOCUMENT' },
    };
    const perDocument = computeTotals(input);
    const perLine = computeTotals({ ...input, rounding: { mode: 'HALF_UP', scale: 2, granularity: 'LINE' } });

    // 1.005 per line: rounded per line it becomes 1.01 twice, per document 2.01.
    expect(perLine.totalHT).toBe('2.02');
    expect(perDocument.totalHT).toBe('2.01');
  });
});
