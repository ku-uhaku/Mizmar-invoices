import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped,
  dueOccurrences,
  firstIndexOnOrAfter,
  localDate,
  occurrenceAt,
  occurrenceDate,
  type ScheduleRule,
} from './schedule';

const monthly = (startDate: string, extra: Partial<ScheduleRule> = {}): ScheduleRule => ({
  frequency: 'MONTHLY',
  interval: 1,
  startDate,
  ...extra,
});

describe('occurrenceDate', () => {
  it('clamps month ends but stays anchored to the original day', () => {
    const rule = monthly('2027-01-31');
    expect([0, 1, 2, 3].map((i) => occurrenceDate(rule, i))).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
  });

  it('uses 29 February in leap years', () => {
    expect(occurrenceDate(monthly('2028-01-31'), 1)).toBe('2028-02-29');
  });

  it('handles weekly with an interval', () => {
    const rule: ScheduleRule = { frequency: 'WEEKLY', interval: 2, startDate: '2027-02-22' };
    expect(occurrenceDate(rule, 1)).toBe('2027-03-08');
  });

  it('handles quarterly and yearly (29 Feb anchor)', () => {
    expect(occurrenceDate({ frequency: 'QUARTERLY', interval: 1, startDate: '2027-11-30' }, 1)).toBe(
      '2028-02-29',
    );
    const yearly: ScheduleRule = { frequency: 'YEARLY', interval: 1, startDate: '2028-02-29' };
    expect([1, 2, 4].map((i) => occurrenceDate(yearly, i))).toEqual([
      '2029-02-28',
      '2030-02-28',
      '2032-02-29',
    ]);
  });

  it('crosses year boundaries', () => {
    expect(addMonthsClamped('2027-11-15', 3)).toBe('2028-02-15');
    expect(addMonthsClamped('2027-01-31', -2)).toBe('2026-11-30');
  });

  it('rejects bad input', () => {
    expect(() => occurrenceDate(monthly('2027-01-31', { interval: 0 }), 1)).toThrow();
    expect(() => occurrenceDate(monthly('nope'), 1)).toThrow();
  });
});

describe('limits', () => {
  it('stops at endDate (inclusive) and maxOccurrences', () => {
    const ended = monthly('2027-01-31', { endDate: '2027-03-31' });
    expect(occurrenceAt(ended, 2)?.date).toBe('2027-03-31');
    expect(occurrenceAt(ended, 3)).toBeNull();
    expect(occurrenceAt(monthly('2027-01-01', { maxOccurrences: 2 }), 2)).toBeNull();
  });
});

describe('dueOccurrences (catch-up)', () => {
  const rule = monthly('2027-01-31');

  it('returns nothing before the next date', () => {
    expect(dueOccurrences(rule, 1, '2027-02-27', 10)).toEqual([]);
  });

  it('returns every missed run oldest first', () => {
    expect(dueOccurrences(rule, 0, '2027-04-05', 10).map((o) => o.date)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
  });

  it('caps the batch and resumes from the next index', () => {
    const first = dueOccurrences(rule, 0, '2027-12-31', 3);
    expect(first.map((o) => o.index)).toEqual([0, 1, 2]);
    const second = dueOccurrences(rule, 3, '2027-12-31', 3);
    expect(second.map((o) => o.index)).toEqual([3, 4, 5]);
  });

  it('never goes past the end of the series', () => {
    expect(
      dueOccurrences(monthly('2027-01-01', { maxOccurrences: 2 }), 0, '2030-01-01', 10),
    ).toHaveLength(2);
  });
});

describe('firstIndexOnOrAfter', () => {
  it('skips occurrences in the past', () => {
    expect(firstIndexOnOrAfter(monthly('2027-01-31'), '2027-03-01')).toBe(2);
  });
});

describe('localDate', () => {
  it('uses the company timezone, not UTC', () => {
    const instant = new Date('2027-06-30T23:30:00Z');
    expect(localDate(instant, 'UTC')).toBe('2027-06-30');
    expect(localDate(instant, 'Pacific/Auckland')).toBe('2027-07-01');
    expect(localDate(instant, 'America/Los_Angeles')).toBe('2027-06-30');
  });

  it('defaults to Africa/Casablanca', () => {
    // The offset depends on the tz database (Morocco has changed it), so compare
    // against the explicit zone rather than hard-coding a day.
    const instant = new Date('2027-01-15T23:30:00Z');
    expect(localDate(instant)).toBe(localDate(instant, 'Africa/Casablanca'));
  });
});
