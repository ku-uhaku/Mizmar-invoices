import { ageingBucket, dec, type AgeingBucket } from '@mizmar/core';
import { moneyOut } from '../common/util/decimal';

export interface AgeingInput {
  contactId: string;
  contactName: string;
  dueDate: Date | null;
  /** Outstanding amount as a decimal string; non-positive rows are ignored. */
  outstanding: string;
}

export interface AgeingBucketsOut {
  CURRENT: string;
  D1_30: string;
  D31_60: string;
  D61_90: string;
  D90_PLUS: string;
  total: string;
}

export interface AgeingRowOut {
  contactId: string;
  contactName: string;
  invoiceCount: number;
  buckets: AgeingBucketsOut;
}

const KEYS: AgeingBucket[] = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'];

function emptyBuckets() {
  return { CURRENT: dec(0), D1_30: dec(0), D31_60: dec(0), D61_90: dec(0), D90_PLUS: dec(0) };
}

function out(buckets: ReturnType<typeof emptyBuckets>): AgeingBucketsOut {
  let total = dec(0);
  for (const key of KEYS) total = total.plus(buckets[key]);
  return {
    CURRENT: moneyOut(buckets.CURRENT),
    D1_30: moneyOut(buckets.D1_30),
    D31_60: moneyOut(buckets.D31_60),
    D61_90: moneyOut(buckets.D61_90),
    D90_PLUS: moneyOut(buckets.D90_PLUS),
    total: moneyOut(total),
  };
}

/** Bucket for one invoice; no due date means the money is not yet due. */
export function bucketFor(dueDate: Date | null, now: Date): AgeingBucket {
  return dueDate ? ageingBucket(dueDate, now) : 'CURRENT';
}

/** Group outstanding invoices per customer into ageing buckets, largest debtor first. */
export function buildAgeing(
  inputs: AgeingInput[],
  now: Date,
): { rows: AgeingRowOut[]; totals: AgeingBucketsOut } {
  const perContact = new Map<
    string,
    { name: string; count: number; buckets: ReturnType<typeof emptyBuckets> }
  >();
  const grand = emptyBuckets();

  for (const input of inputs) {
    const amount = dec(input.outstanding);
    if (amount.lte(0)) continue;
    const bucket = bucketFor(input.dueDate, now);

    let entry = perContact.get(input.contactId);
    if (!entry) {
      entry = { name: input.contactName, count: 0, buckets: emptyBuckets() };
      perContact.set(input.contactId, entry);
    }
    entry.count += 1;
    entry.buckets[bucket] = entry.buckets[bucket].plus(amount);
    grand[bucket] = grand[bucket].plus(amount);
  }

  const rows = [...perContact.entries()].map(([contactId, entry]) => ({
    contactId,
    contactName: entry.name,
    invoiceCount: entry.count,
    buckets: out(entry.buckets),
  }));
  rows.sort(
    (a, b) =>
      dec(b.buckets.total).comparedTo(dec(a.buckets.total)) ||
      a.contactName.localeCompare(b.contactName),
  );

  return { rows, totals: out(grand) };
}

/** Reminder severity: first nudge is friendly, then firm, then a final notice. */
export function reminderLevel(previousCount: number): 1 | 2 | 3 {
  return Math.min(previousCount + 1, 3) as 1 | 2 | 3;
}

export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function isWithinCooldown(lastSentAt: Date | null, now: Date): boolean {
  return lastSentAt !== null && now.getTime() - lastSentAt.getTime() < REMINDER_COOLDOWN_MS;
}
