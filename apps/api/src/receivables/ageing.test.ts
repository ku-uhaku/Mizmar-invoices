import { describe, expect, it } from 'vitest';
import {
  bucketFor,
  buildAgeing,
  isWithinCooldown,
  reminderLevel,
  type AgeingInput,
} from './ageing';
import { buildReminderMessage } from './reminder-template';

const NOW = new Date('2026-10-07T10:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('bucketFor', () => {
  it('puts not-yet-due and undated invoices in CURRENT', () => {
    expect(bucketFor(d('2026-10-07'), NOW)).toBe('CURRENT');
    expect(bucketFor(d('2026-11-01'), NOW)).toBe('CURRENT');
    expect(bucketFor(null, NOW)).toBe('CURRENT');
  });

  it('applies the 1-30 / 31-60 / 61-90 / 90+ boundaries', () => {
    expect(bucketFor(d('2026-10-06'), NOW)).toBe('D1_30'); // 1 day
    expect(bucketFor(d('2026-09-07'), NOW)).toBe('D1_30'); // 30 days
    expect(bucketFor(d('2026-09-06'), NOW)).toBe('D31_60'); // 31
    expect(bucketFor(d('2026-08-08'), NOW)).toBe('D31_60'); // 60
    expect(bucketFor(d('2026-08-07'), NOW)).toBe('D61_90'); // 61
    expect(bucketFor(d('2026-07-09'), NOW)).toBe('D61_90'); // 90
    expect(bucketFor(d('2026-07-08'), NOW)).toBe('D90_PLUS'); // 91
  });
});

describe('buildAgeing', () => {
  const rows: AgeingInput[] = [
    { contactId: 'a', contactName: 'Alpha', dueDate: d('2026-10-01'), outstanding: '100.10' },
    { contactId: 'a', contactName: 'Alpha', dueDate: d('2026-06-01'), outstanding: '50.20' },
    { contactId: 'a', contactName: 'Alpha', dueDate: d('2026-12-01'), outstanding: '10.00' },
    { contactId: 'b', contactName: 'Beta', dueDate: d('2026-09-01'), outstanding: '500.00' },
    { contactId: 'c', contactName: 'Paid', dueDate: d('2026-09-01'), outstanding: '0.00' },
  ];

  it('sums per customer without float drift and totals the columns', () => {
    const { rows: out, totals } = buildAgeing(rows, NOW);
    expect(out.map((r) => r.contactId)).toEqual(['b', 'a']); // largest debtor first
    const alpha = out.find((r) => r.contactId === 'a')!;
    expect(alpha.invoiceCount).toBe(3);
    expect(alpha.buckets).toEqual({
      CURRENT: '10.00',
      D1_30: '100.10',
      D31_60: '0.00',
      D61_90: '0.00',
      D90_PLUS: '50.20',
      total: '160.30',
    });
    expect(totals.D31_60).toBe('500.00');
    expect(totals.total).toBe('660.30');
  });

  it('ignores settled invoices', () => {
    expect(buildAgeing(rows, NOW).rows.find((r) => r.contactId === 'c')).toBeUndefined();
  });
});

describe('reminders', () => {
  it('escalates the level and caps it at 3', () => {
    expect([0, 1, 2, 3, 9].map(reminderLevel)).toEqual([1, 2, 3, 3, 3]);
  });

  it('enforces a 24h cool-down', () => {
    expect(isWithinCooldown(null, NOW)).toBe(false);
    expect(isWithinCooldown(new Date(NOW.getTime() - 23 * 3_600_000), NOW)).toBe(true);
    expect(isWithinCooldown(new Date(NOW.getTime() - 25 * 3_600_000), NOW)).toBe(false);
  });

  it('localizes the message', () => {
    const base = {
      level: 1 as const,
      contactName: 'Acme',
      companyName: 'Mizmar',
      invoices: [
        { number: 'FA-1', dueDate: '2026-09-01', daysOverdue: 36, outstanding: '10.00', currency: 'MAD' },
      ],
    };
    expect(buildReminderMessage({ ...base, locale: 'FR' }).subject).toContain('Rappel');
    expect(buildReminderMessage({ ...base, locale: 'EN' }).subject).toContain('reminder');
    expect(buildReminderMessage({ ...base, locale: 'AR' }).body).toContain('FA-1');
    expect(buildReminderMessage({ ...base, level: 3, locale: 'EN' }).subject).toContain('Final');
  });
});
