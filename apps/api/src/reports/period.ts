export type Period = 'day' | 'week' | 'month';

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Bucket key for a date: the day itself, the Monday starting its ISO week, or
 * the first of its month. All computed in UTC because document dates are
 * calendar dates with no time zone.
 */
export function periodKey(date: Date, period: Period): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (period === 'day') return iso(day);
  if (period === 'month') return iso(day).slice(0, 7);
  const offset = (day.getUTCDay() + 6) % 7; // Monday = 0
  day.setUTCDate(day.getUTCDate() - offset);
  return iso(day);
}
