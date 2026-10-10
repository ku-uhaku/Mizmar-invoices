/**
 * Leave maths on calendar dates ("YYYY-MM-DD"), never instants.
 *
 * Moroccan "jours ouvrables" are Monday to Saturday, so only Sundays are skipped.
 */

const parse = (date: string) => new Date(`${date}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Working days (Mon-Sat) from `start` to `end`, both inclusive. */
export function workingDays(start: string, end: string): number {
  if (end < start) return 0;
  let count = 0;
  for (const day = parse(start); iso(day) <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0) count++;
  }
  return count;
}

/** Working days of [start, end] that fall inside [from, to]; used to split a leave across months. */
export function workingDaysWithin(start: string, end: string, from: string, to: string): number {
  const s = start > from ? start : from;
  const e = end < to ? end : to;
  return workingDays(s, e);
}

/**
 * Yearly entitlement for `year`, pro-rated by whole months worked in the hire
 * year (hired in March => 10/12 of the year) and rounded to the half day.
 */
export function leaveEntitlement(daysPerYear: number, hireDate: string, year: number): number {
  const hireYear = Number(hireDate.slice(0, 4));
  if (hireYear > year) return 0;
  const months = hireYear < year ? 12 : 12 - (Number(hireDate.slice(5, 7)) - 1);
  return Math.round(((daysPerYear * months) / 12) * 2) / 2;
}
