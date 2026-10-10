import { dec } from '@mizmar/core';
import type { reportSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { moneyOut, qtyOut } from '../common/util/decimal';

export type TableColumn = z.infer<typeof reportSchemas.tableColumn>;
export type TableRow = Record<string, string | number | null>;

export const col = (key: string, label: string, type: TableColumn['type'] = 'text'): TableColumn => ({
  key,
  label,
  type,
});

/** Sum the money, quantity and integer columns listed in `sumKeys` into a totals row. */
export function totalsRow(
  columns: TableColumn[],
  rows: TableRow[],
  sumKeys: string[],
  label?: { key: string; text: string },
): TableRow {
  const totals: TableRow = {};
  for (const column of columns) totals[column.key] = null;
  if (label) totals[label.key] = label.text;
  for (const key of sumKeys) {
    const type = columns.find((column) => column.key === key)?.type;
    const sum = rows.reduce((acc, row) => acc.plus(dec(String(row[key] ?? 0))), dec(0));
    totals[key] = type === 'money' ? moneyOut(sum) : type === 'qty' ? qtyOut(sum) : sum.toNumber();
  }
  return totals;
}

/** `part / whole` as a percentage with two decimals; "0.00" when there is no whole. */
export function pct(part: { toString(): string }, whole: { toString(): string }): string {
  const w = dec(whole.toString());
  if (w.isZero()) return '0.00';
  return dec(part.toString()).div(w).times(100).toFixed(2);
}

/** Days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export type AgeingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

/** Bucket for an amount that is `daysOverdue` days past due (<= 0 means not yet due). */
export function ageingBucket(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
}
