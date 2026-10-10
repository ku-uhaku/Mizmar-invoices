import { z } from 'zod';
import { isoDate, decimalString, uuid } from './common';
import { ageingBucketEnum, ageingBuckets } from './receivables';

export const payablesQuery = z.object({
  contactId: uuid.optional(),
});

/** One unpaid bill: a purchase invoice or an expense. */
export const payableItem = z.object({
  source: z.enum(['DOCUMENT', 'EXPENSE', 'OPENING']),
  id: uuid,
  /** Supplier, null for an expense that has none. */
  contactId: uuid.nullable(),
  contactName: z.string(),
  reference: z.string().nullable(),
  issueDate: isoDate,
  dueDate: isoDate.nullable(),
  currency: z.string(),
  total: decimalString,
  paid: decimalString,
  outstanding: decimalString,
  /** Positive when overdue; negative days until due; null without a due date. */
  daysOverdue: z.number().int().nullable(),
  bucket: ageingBucketEnum,
});

export const payablesRow = z.object({
  contactId: uuid.nullable(),
  contactName: z.string(),
  billCount: z.number().int(),
  buckets: ageingBuckets,
});

export const payablesOverview = z.object({
  currency: z.string(),
  asOf: isoDate,
  totals: ageingBuckets,
  /** Unpaid and past due. */
  overdueTotal: decimalString,
  /** Falling due in the next 7 days. */
  dueSoonTotal: decimalString,
  rows: z.array(payablesRow),
  items: z.array(payableItem),
});

export type PayablesOverview = z.infer<typeof payablesOverview>;
