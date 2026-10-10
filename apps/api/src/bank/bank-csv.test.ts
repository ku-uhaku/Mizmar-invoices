import { describe, expect, it } from 'vitest';
import { parseAmount, parseBankDate, parseBankStatement } from './bank-csv';

describe('parseAmount', () => {
  it.each([
    ['1 234,56', '1234.56'],
    ['1.234,56', '1234.56'],
    ['1,234.56', '1234.56'],
    ['-12,5', '-12.50'],
    ['(12.50)', '-12.50'],
    ['300', '300.00'],
  ])('reads %s', (raw, expected) => expect(parseAmount(raw)).toBe(expected));

  it('rejects text and blanks', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('parseBankDate', () => {
  it('reads the common formats', () => {
    expect(parseBankDate('2026-10-05')).toBe('2026-10-05');
    expect(parseBankDate('05/10/2026')).toBe('2026-10-05');
    expect(parseBankDate('5.10.26')).toBe('2026-10-05');
  });
  it('rejects impossible dates', () => {
    expect(parseBankDate('31/02/2026')).toBeNull();
    expect(parseBankDate('hello')).toBeNull();
  });
});

describe('parseBankStatement', () => {
  it('reads debit and credit columns and signs the amount', () => {
    const csv = 'Date opération;Libellé;Débit;Crédit;Solde\n05/10/2026;VIREMENT CLIENT ABC;;1 200,00;5 000,00\n06/10/2026;CHEQUE 1001;300,00;;4 700,00\n';
    const { lines, skipped } = parseBankStatement(csv);
    expect(skipped).toEqual([]);
    expect(lines.map((l) => l.amount)).toEqual(['1200.00', '-300.00']);
    expect(lines[0]!.balance).toBe('5000.00');
  });

  it('reads one signed amount column and reports bad rows', () => {
    const csv = 'date,description,amount\n2026-10-05,Rent,-5000\nnope,Bad,10\n2026-10-06,Zero,0\n';
    const { lines, skipped } = parseBankStatement(csv);
    expect(lines).toHaveLength(1);
    expect(skipped.map((s) => s.reason)).toEqual(['Unreadable date', 'No amount']);
  });

  it('gives identical rows identical fingerprints', () => {
    const a = parseBankStatement('date,description,amount\n2026-10-05,Rent,-5000\n').lines[0]!;
    const b = parseBankStatement('date,description,amount\n2026-10-05, rent ,-5000.00\n').lines[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('needs a date and an amount', () => {
    expect(() => parseBankStatement('foo,bar\n1,2\n')).toThrow();
  });
});
