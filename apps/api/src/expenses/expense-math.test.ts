import { describe, expect, it } from 'vitest';
import {
  expenseAmounts,
  isOverdue,
  nextOccurrenceAfter,
  plusDays,
  settlementStatus,
} from './expense-math';

describe('expenseAmounts', () => {
  it('adds VAT rounded to cents', () => {
    const { vat, total } = expenseAmounts('833.33', '20');
    expect(vat.toFixed(2)).toBe('166.67');
    expect(total.toFixed(2)).toBe('1000.00');
  });
  it('handles a zero rate', () => {
    expect(expenseAmounts('100', '0').total.toFixed(2)).toBe('100.00');
  });
});

describe('settlementStatus', () => {
  it('derives from payments', () => {
    expect(settlementStatus('UNPAID', '100', '0')).toBe('UNPAID');
    expect(settlementStatus('UNPAID', '100', '40')).toBe('PARTIAL');
    expect(settlementStatus('PARTIAL', '100', '100')).toBe('PAID');
    expect(settlementStatus('PAID', '100', '0')).toBe('UNPAID');
  });
  it('keeps drafts and cancelled bills as they are', () => {
    expect(settlementStatus('DRAFT', '100', '100')).toBe('DRAFT');
    expect(settlementStatus('CANCELLED', '100', '0')).toBe('CANCELLED');
  });
});

describe('isOverdue', () => {
  it('only open bills past their due date', () => {
    expect(isOverdue('UNPAID', '2026-01-01', '2026-02-01')).toBe(true);
    expect(isOverdue('PAID', '2026-01-01', '2026-02-01')).toBe(false);
    expect(isOverdue('UNPAID', null, '2026-02-01')).toBe(false);
    expect(isOverdue('UNPAID', '2026-02-01', '2026-02-01')).toBe(false);
  });
});

describe('nextOccurrenceAfter', () => {
  const rule = { frequency: 'MONTHLY', interval: 1, startDate: '2026-01-31' } as const;
  it('clamps to month end without drifting', () => {
    expect(nextOccurrenceAfter(rule, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrenceAfter(rule, '2026-02-28')).toBe('2026-03-31');
  });
  it('returns null at the end date', () => {
    expect(nextOccurrenceAfter({ ...rule, endDate: '2026-02-28' }, '2026-02-28')).toBeNull();
  });
});

describe('plusDays', () => {
  it('crosses month ends', () => {
    expect(plusDays('2026-01-25', 15)).toBe('2026-02-09');
  });
});
