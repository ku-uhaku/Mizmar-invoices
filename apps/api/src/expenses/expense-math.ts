import { dec, firstIndexOnOrAfter, occurrenceAt, type ScheduleRule } from '@mizmar/core';

export type ExpenseStatusValue = 'DRAFT' | 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';

/** VAT and total from a net amount and a rate in percent, rounded to cents. */
export function expenseAmounts(amountExclVat: string, vatRate: string) {
  const net = dec(amountExclVat).toDecimalPlaces(2);
  const vat = net.times(dec(vatRate)).div(100).toDecimalPlaces(2);
  return { net, vat, total: net.plus(vat) };
}

/** Settlement status derived from what has been paid; drafts and cancellations are sticky. */
export function settlementStatus(
  current: ExpenseStatusValue,
  total: string,
  paid: string,
): ExpenseStatusValue {
  if (current === 'DRAFT' || current === 'CANCELLED') return current;
  const paidAmount = dec(paid);
  if (paidAmount.lte(0)) return 'UNPAID';
  return paidAmount.gte(dec(total)) ? 'PAID' : 'PARTIAL';
}

export function isOverdue(status: ExpenseStatusValue, dueDate: string | null, today: string): boolean {
  return (status === 'UNPAID' || status === 'PARTIAL') && dueDate !== null && dueDate < today;
}

/** The occurrence date following `current`, or null when the series is over. */
export function nextOccurrenceAfter(rule: ScheduleRule, current: string): string | null {
  const index = firstIndexOnOrAfter(rule, current);
  return occurrenceAt(rule, index + 1)?.date ?? null;
}

/** `date` plus `days` calendar days, as "YYYY-MM-DD". */
export function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
