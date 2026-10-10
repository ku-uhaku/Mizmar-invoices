import { describe, expect, it } from 'vitest';
import { ageingBucket, col, daysBetween, pct, totalsRow } from './table';

describe('totalsRow', () => {
  const columns = [col('name', 'Nom'), col('amount', 'Montant', 'money'), col('n', 'Nb', 'int')];
  it('sums money and integers, and labels the row', () => {
    const totals = totalsRow(
      columns,
      [
        { name: 'a', amount: '10.10', n: 1 },
        { name: 'b', amount: '5.20', n: 2 },
      ],
      ['amount', 'n'],
      { key: 'name', text: 'Total' },
    );
    expect(totals).toEqual({ name: 'Total', amount: '15.30', n: 3 });
  });
});

describe('pct', () => {
  it('computes a share', () => expect(pct('25', '200')).toBe('12.50'));
  it('is zero without a whole', () => expect(pct('5', '0')).toBe('0.00'));
});

describe('ageing', () => {
  it('buckets by days overdue', () => {
    expect([-3, 0, 1, 30, 31, 60, 61, 90, 91].map(ageingBucket)).toEqual([
      'current', 'current', 'd1_30', 'd1_30', 'd31_60', 'd31_60', 'd61_90', 'd61_90', 'd90_plus',
    ]);
  });
  it('counts days between dates', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-02-01', '2026-01-01')).toBe(-31);
  });
});
