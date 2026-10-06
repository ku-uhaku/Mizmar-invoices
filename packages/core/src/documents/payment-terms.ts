export const PAYMENT_TERMS = [
  'IMMEDIATE',
  'NET_15',
  'NET_30',
  'NET_45',
  'NET_60',
  'NET_90',
  'END_OF_MONTH',
  'END_OF_NEXT_MONTH',
  'CUSTOM',
] as const;

export type PaymentTerm = (typeof PAYMENT_TERMS)[number];

const NET_DAYS: Partial<Record<PaymentTerm, number>> = {
  IMMEDIATE: 0,
  NET_15: 15,
  NET_30: 30,
  NET_45: 45,
  NET_60: 60,
  NET_90: 90,
};

function atUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfMonth(date: Date, monthsAhead = 0): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthsAhead + 1, 0));
}

/**
 * Due date from the issue date and the contact's terms.
 * Computed in UTC at midnight so a document issued late in the evening does not
 * drift a day depending on the server's timezone.
 */
export function dueDateFrom(
  issueDate: Date | string,
  term: PaymentTerm,
  customDays?: number | null,
): Date {
  const base = atUtcMidnight(issueDate instanceof Date ? issueDate : new Date(issueDate));

  if (term === 'END_OF_MONTH') return endOfMonth(base, 0);
  if (term === 'END_OF_NEXT_MONTH') return endOfMonth(base, 1);

  const days = term === 'CUSTOM' ? (customDays ?? 0) : (NET_DAYS[term] ?? 0);
  const due = new Date(base);
  due.setUTCDate(due.getUTCDate() + days);
  return due;
}

/** Whole days overdue, for statement ageing. Zero when not yet due. */
export function daysOverdue(dueDate: Date | string, now: Date = new Date()): number {
  const due = atUtcMidnight(dueDate instanceof Date ? dueDate : new Date(dueDate));
  const today = atUtcMidnight(now);
  const diff = today.getTime() - due.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / 86_400_000);
}

export const AGEING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** Standard receivables ageing bucket for a statement row. */
export function ageingBucket(dueDate: Date | string, now: Date = new Date()): AgeingBucket {
  const days = daysOverdue(dueDate, now);
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return 'D1_30';
  if (days <= 60) return 'D31_60';
  if (days <= 90) return 'D61_90';
  return 'D90_PLUS';
}
