import { describe, expect, it } from 'vitest';
import { aggregateVat, buildStatementRows, groupSales } from './aggregate';
import { csvCell, toCsv } from './csv';
import { periodKey } from './period';

describe('csv', () => {
  it('prefixes a BOM and uses CRLF', () => {
    const out = toCsv([['a', 'b'], ['1', '2']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toBe('﻿a;b\r\n1;2\r\n');
  });

  it('quotes separators, quotes and newlines', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('a,b', { separator: ',' })).toBe('"a,b"');
  });

  it('neutralises formula injection in text', () => {
    expect(csvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(1)')).toBe("'@SUM(1)");
    expect(csvCell('\t=x')).toBe("'\t=x");
  });

  it('leaves real numbers, including negatives, untouched', () => {
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
  });

  it('supports a decimal comma', () => {
    expect(csvCell('12.50', { decimalComma: true })).toBe('12,50');
    expect(csvCell('a.b', { decimalComma: true })).toBe('a.b');
  });
});

describe('periodKey', () => {
  it('groups by day, ISO week (Monday) and month', () => {
    const wed = new Date('2026-10-07T15:00:00Z');
    expect(periodKey(wed, 'day')).toBe('2026-10-07');
    expect(periodKey(wed, 'week')).toBe('2026-10-05');
    expect(periodKey(wed, 'month')).toBe('2026-10');
  });

  it('puts Sunday in the previous Monday week and crosses month ends', () => {
    expect(periodKey(new Date('2026-10-11T00:00:00Z'), 'week')).toBe('2026-10-05');
    expect(periodKey(new Date('2026-11-01T00:00:00Z'), 'week')).toBe('2026-10-26');
    expect(periodKey(new Date('2026-10-12T00:00:00Z'), 'week')).toBe('2026-10-12');
  });
});

describe('groupSales', () => {
  it('nets credit notes and counts distinct documents', () => {
    const { rows, totals } = groupSales([
      { key: '2026-10', label: '2026-10', documentId: '1', sign: 1, exclVat: '100.00', vat: '20.00', inclVat: '120.00' },
      { key: '2026-10', label: '2026-10', documentId: '2', sign: 1, exclVat: '0.10', vat: '0.02', inclVat: '0.12' },
      { key: '2026-10', label: '2026-10', documentId: '3', sign: -1, exclVat: '-40.00', vat: '-8.00', inclVat: '-48.00' },
      { key: '2026-09', label: '2026-09', documentId: '4', sign: 1, exclVat: '5.00', vat: '1.00', inclVat: '6.00' },
    ]);
    expect(rows.map((r) => r.key)).toEqual(['2026-09', '2026-10']);
    expect(rows[1]).toMatchObject({
      documentCount: 3,
      totalExclVat: '60.10',
      totalVat: '12.02',
      totalInclVat: '72.12',
    });
    expect(totals.totalExclVat).toBe('65.10');
  });

  it('sums quantities when present', () => {
    const { rows } = groupSales([
      { key: 'v', label: 'v', documentId: '1', sign: 1, exclVat: '1', vat: '0', inclVat: '1', quantity: '2.5' },
      { key: 'v', label: 'v', documentId: '2', sign: -1, exclVat: '1', vat: '0', inclVat: '1', quantity: '1' },
    ]);
    expect(rows[0]!.quantity).toBe('1.500000');
  });
});

describe('aggregateVat', () => {
  it('sums base and VAT per rate and subtracts credit notes', () => {
    const out = aggregateVat([
      { sign: 1, buckets: [{ rate: '20', base: '100.00', amount: '20.00' }, { rate: '10', base: '50.00', amount: '5.00' }] },
      { sign: 1, buckets: [{ rate: '20.000', base: '0.10', amount: '0.02' }] },
      { sign: -1, buckets: [{ rate: 20, base: '-30.00', amount: '-6.00' }] },
    ]);
    expect(out.rows).toEqual([
      { rate: '10.00', base: '50.00', vat: '5.00' },
      { rate: '20.00', base: '70.10', vat: '14.02' },
    ]);
    expect(out.totalBase).toBe('120.10');
    expect(out.totalVat).toBe('19.02');
  });

  it('handles no documents', () => {
    expect(aggregateVat([])).toEqual({ rows: [], totalBase: '0.00', totalVat: '0.00' });
  });
});

describe('buildStatementRows', () => {
  const entry = (date: string, debit: string, credit: string) => ({
    date,
    kind: 'DOCUMENT' as const,
    reference: '',
    label: '',
    debit,
    credit,
  });

  it('folds earlier entries into the opening balance and runs a balance', () => {
    const out = buildStatementRows(
      [
        entry('2026-08-01', '100.00', '0.00'),
        entry('2026-08-15', '0.00', '30.00'),
        entry('2026-09-02', '50.00', '0.00'),
        entry('2026-09-10', '0.00', '20.00'),
      ],
      '2026-09-01',
    );
    expect(out.openingBalance).toBe('70.00');
    expect(out.rows.map((r) => r.balance)).toEqual(['120.00', '100.00']);
    expect(out.closingBalance).toBe('100.00');
    expect(out.totalDebit).toBe('50.00');
    expect(out.totalCredit).toBe('20.00');
  });
});
