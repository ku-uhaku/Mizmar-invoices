import { describe, expect, it } from 'vitest';
import { DEFAULT_NUMBER_FORMAT, defaultPrefix, draftLabel, formatDocumentNumber, sequenceKey } from './numbering';
import { ageingBucket, daysOverdue, dueDateFrom } from './documents/payment-terms';

describe('formatDocumentNumber', () => {
  const ctx = { prefix: 'FA', sequence: 7, year: 2026, month: 3, companyCode: 'MZ' };

  it('renders the default format', () => {
    expect(formatDocumentNumber(DEFAULT_NUMBER_FORMAT, ctx)).toBe('FA-2026-0007');
  });

  it('pads the sequence to the requested width', () => {
    expect(formatDocumentNumber('{SEQ:6}', ctx)).toBe('000007');
    expect(formatDocumentNumber('{SEQ}', ctx)).toBe('7');
  });

  it('supports short year, month and company code', () => {
    expect(formatDocumentNumber('{COMPANY}/{YY}{MM}/{SEQ:3}', ctx)).toBe('MZ/2603/007');
  });

  it('does not overflow a sequence wider than its padding', () => {
    expect(formatDocumentNumber('{SEQ:2}', { ...ctx, sequence: 12345 })).toBe('12345');
  });

  it('leaves an unknown token visible instead of silently dropping it', () => {
    expect(formatDocumentNumber('{PREFIX}-{NOPE}', ctx)).toBe('FA-{NOPE}');
  });

  it('renders an empty company code rather than "undefined"', () => {
    expect(formatDocumentNumber('{COMPANY}-{SEQ}', { ...ctx, companyCode: null })).toBe('-7');
  });

  it('uses the documented French prefixes', () => {
    expect(defaultPrefix('DEVIS')).toBe('DV');
    expect(defaultPrefix('SALES_ORDER')).toBe('BC');
    expect(defaultPrefix('DELIVERY_NOTE')).toBe('BL');
    expect(defaultPrefix('SALES_INVOICE')).toBe('FA');
    expect(defaultPrefix('CREDIT_NOTE')).toBe('AV');
    expect(defaultPrefix('GOODS_RECEIPT')).toBe('BR');
  });

  it('gives a draft a stable short label and never a real number', () => {
    const label = draftLabel('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(label).toBe('#3F2504');
    expect(label).not.toMatch(/\d{4}-\d{4}/);
  });

  it('keys sequences per company, type and year', () => {
    expect(sequenceKey('co-1', 'SALES_INVOICE', 2026)).toBe('co-1:SALES_INVOICE:2026');
  });
});

describe('payment terms', () => {
  it('computes net due dates', () => {
    expect(dueDateFrom('2026-01-15', 'IMMEDIATE').toISOString().slice(0, 10)).toBe('2026-01-15');
    expect(dueDateFrom('2026-01-15', 'NET_30').toISOString().slice(0, 10)).toBe('2026-02-14');
    expect(dueDateFrom('2026-01-15', 'NET_60').toISOString().slice(0, 10)).toBe('2026-03-16');
  });

  it('computes end-of-month terms', () => {
    expect(dueDateFrom('2026-01-15', 'END_OF_MONTH').toISOString().slice(0, 10)).toBe('2026-01-31');
    expect(dueDateFrom('2026-01-15', 'END_OF_NEXT_MONTH').toISOString().slice(0, 10)).toBe('2026-02-28');
    // Leap year, so the end of February is the 29th.
    expect(dueDateFrom('2028-01-15', 'END_OF_NEXT_MONTH').toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('supports a custom day count', () => {
    expect(dueDateFrom('2026-01-15', 'CUSTOM', 10).toISOString().slice(0, 10)).toBe('2026-01-25');
    expect(dueDateFrom('2026-01-15', 'CUSTOM', null).toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('does not drift with the time of day', () => {
    const evening = dueDateFrom('2026-01-15T23:45:00Z', 'NET_30');
    const morning = dueDateFrom('2026-01-15T00:15:00Z', 'NET_30');
    expect(evening.toISOString()).toBe(morning.toISOString());
  });

  it('counts whole days overdue and nothing before the due date', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    expect(daysOverdue('2026-10-01', now)).toBe(5);
    expect(daysOverdue('2026-10-06', now)).toBe(0);
    expect(daysOverdue('2026-12-01', now)).toBe(0);
  });

  it('buckets receivables for the statement', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    expect(ageingBucket('2026-10-31', now)).toBe('CURRENT');
    expect(ageingBucket('2026-10-01', now)).toBe('D1_30');
    expect(ageingBucket('2026-08-20', now)).toBe('D31_60');
    expect(ageingBucket('2026-07-20', now)).toBe('D61_90');
    expect(ageingBucket('2026-01-01', now)).toBe('D90_PLUS');
  });
});
