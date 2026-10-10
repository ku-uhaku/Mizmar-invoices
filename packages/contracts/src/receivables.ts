import { z } from 'zod';
import { decimalString, isoDate, isoDateTime, localeEnum, uuid } from './common';

export const ageingBucketEnum = z.enum(['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS']);

/** Buckets that are actually past due (the overdue list never shows CURRENT). */
export const overdueBucketEnum = z.enum(['D1_30', 'D31_60', 'D61_90', 'D90_PLUS']);

export const overdueQuery = z.object({
  contactId: uuid.optional(),
  bucket: overdueBucketEnum.optional(),
});

export const overdueInvoice = z.object({
  documentId: uuid,
  number: z.string().nullable(),
  contactId: uuid,
  contactName: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  issueDate: isoDate,
  dueDate: isoDate,
  currency: z.string(),
  totalInclVat: decimalString,
  paidAmount: decimalString,
  outstanding: decimalString,
  daysOverdue: z.number().int(),
  bucket: ageingBucketEnum,
  reminderCount: z.number().int(),
  lastRemindedAt: isoDateTime.nullable(),
});

export const overdueResponse = z.object({
  currency: z.string(),
  totalOutstanding: decimalString,
  items: z.array(overdueInvoice),
});

export const ageingBuckets = z.object({
  CURRENT: decimalString,
  D1_30: decimalString,
  D31_60: decimalString,
  D61_90: decimalString,
  D90_PLUS: decimalString,
  total: decimalString,
});

export const ageingRow = z.object({
  contactId: uuid,
  contactName: z.string(),
  invoiceCount: z.number().int(),
  buckets: ageingBuckets,
});

export const ageingResponse = z.object({
  currency: z.string(),
  asOf: isoDate,
  rows: z.array(ageingRow),
  totals: ageingBuckets,
});

export const remindRequest = z
  .object({
    documentIds: z.array(uuid).min(1).max(200).optional(),
    /** Remind every overdue invoice of this contact. */
    contactId: uuid.optional(),
    /** Bypass the 24-hour cool-down. */
    force: z.boolean().default(false),
    attachPdf: z.boolean().default(true),
    locale: localeEnum.optional(),
    /** Where to send; WhatsApp needs the gateway to be configured. */
    channels: z.array(z.enum(['EMAIL', 'WHATSAPP'])).min(1).default(['EMAIL']),
    /** Phone numbers typed in for contacts that have none, keyed by contact id. */
    phones: z.record(uuid, z.string().min(6).max(40)).optional(),
  })
  .refine((v) => v.documentIds?.length || v.contactId, {
    message: 'documentIds or contactId is required',
  });

export const remindOutcome = z.enum([
  'SENT',
  'SKIPPED_RECENT',
  'SKIPPED_NOT_OVERDUE',
  'NO_EMAIL',
  'NO_PHONE',
  'FAILED',
]);

export const remindResponse = z.object({
  results: z.array(
    z.object({
      documentId: uuid,
      /** Needed to ask for a missing phone number. */
      contactId: uuid.nullable(),
      number: z.string().nullable(),
      outcome: remindOutcome,
      level: z.number().int().nullable(),
      message: z.string().nullable(),
    }),
  ),
  sent: z.number().int(),
});

export const reminderRow = z.object({
  id: uuid,
  sentAt: isoDateTime,
  sentByName: z.string().nullable(),
  channel: z.enum(['EMAIL', 'WHATSAPP']),
  level: z.number().int(),
  recipient: z.string().nullable(),
});

export type OverdueInvoice = z.infer<typeof overdueInvoice>;
export type OverdueResponse = z.infer<typeof overdueResponse>;
export type AgeingResponse = z.infer<typeof ageingResponse>;
export type RemindResponse = z.infer<typeof remindResponse>;
export type ReminderRow = z.infer<typeof reminderRow>;
