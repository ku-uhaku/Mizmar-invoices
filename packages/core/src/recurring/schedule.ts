/**
 * Recurring-invoice schedule maths.
 *
 * Everything here works on calendar dates ("YYYY-MM-DD" strings, company-local),
 * never on instants, so a schedule means the same thing in every timezone and
 * across DST changes. The n-th occurrence is always computed from the START
 * date (not from the previous occurrence), so month-end clamping does not
 * drift: 31 Jan -> 28/29 Feb -> 31 Mar -> 30 Apr.
 */

export const RECURRING_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const DEFAULT_TIMEZONE = 'Africa/Casablanca';

export interface ScheduleRule {
  frequency: RecurringFrequency;
  /** Every `interval` weeks / months / quarters / years. */
  interval: number;
  /** First occurrence, "YYYY-MM-DD". Also the day-of-month anchor. */
  startDate: string;
  /** No occurrence after this date (inclusive). */
  endDate?: string | null;
  /** No more than this many occurrences in total. */
  maxOccurrences?: number | null;
}

export interface Occurrence {
  /** Zero-based position in the series. */
  index: number;
  /** "YYYY-MM-DD" */
  date: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(date: string): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid calendar date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parse(date);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return format(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Add months, clamping the day to the target month's length. */
export function addMonthsClamped(date: string, months: number): string {
  const { y, m, d } = parse(date);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  return format(year, month, Math.min(d, daysInMonth(year, month)));
}

const MONTHS_PER_STEP: Record<Exclude<RecurringFrequency, 'WEEKLY'>, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

/** The date of occurrence `index` (0 = startDate), ignoring end/max limits. */
export function occurrenceDate(rule: ScheduleRule, index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error('Occurrence index must be >= 0');
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new Error('Interval must be a positive integer');
  }
  if (rule.frequency === 'WEEKLY') return addDays(rule.startDate, 7 * rule.interval * index);
  return addMonthsClamped(rule.startDate, MONTHS_PER_STEP[rule.frequency] * rule.interval * index);
}

/** The occurrence at `index`, or null when the series has ended before it. */
export function occurrenceAt(rule: ScheduleRule, index: number): Occurrence | null {
  if (rule.maxOccurrences != null && index >= rule.maxOccurrences) return null;
  const date = occurrenceDate(rule, index);
  if (rule.endDate && date > rule.endDate) return null;
  return { index, date };
}

/**
 * Occurrences already due (date <= today) starting at `fromIndex`, oldest
 * first and capped, so a schedule that was paused for two years catches up in
 * bounded steps over several ticks instead of in one burst.
 */
export function dueOccurrences(
  rule: ScheduleRule,
  fromIndex: number,
  today: string,
  cap: number,
): Occurrence[] {
  const due: Occurrence[] = [];
  for (let index = fromIndex; due.length < cap; index++) {
    const occurrence = occurrenceAt(rule, index);
    if (!occurrence || occurrence.date > today) break;
    due.push(occurrence);
  }
  return due;
}

/** Index of the first occurrence on or after `from`. */
export function firstIndexOnOrAfter(rule: ScheduleRule, from: string): number {
  let index = 0;
  while (occurrenceDate(rule, index) < from) {
    index++;
    if (index > 100_000) throw new Error('Schedule never reaches the requested date');
  }
  return index;
}

/** Today's calendar date in an IANA timezone, as "YYYY-MM-DD". */
export function localDate(now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  // The en-CA locale formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}
