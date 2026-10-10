import { z } from 'zod';
import { decimalString, isoDate, uuid } from './common';

export const accountTypeEnum = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
export const journalSourceEnum = z.enum(['MANUAL', 'DOCUMENT', 'PAYMENT', 'EXPENSE', 'EXPENSE_PAYMENT', 'OPENING']);

export const account = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  type: accountTypeEnum,
  /** Set on accounts the automatic postings use. */
  role: z.string().nullable(),
  isActive: z.boolean(),
  debit: decimalString,
  credit: decimalString,
  /** debit - credit */
  balance: decimalString,
});

export const accountBody = z.object({
  code: z.string().trim().regex(/^\d{3,10}$/, 'Digits only, 3 to 10'),
  name: z.string().trim().min(1).max(120),
  type: accountTypeEnum,
  isActive: z.boolean().default(true),
});

export const journalLine = z.object({
  accountId: uuid,
  code: z.string(),
  name: z.string(),
  debit: decimalString,
  credit: decimalString,
  label: z.string().nullable(),
});

export const journalEntry = z.object({
  id: uuid,
  seq: z.number().int(),
  date: isoDate,
  label: z.string(),
  source: journalSourceEnum,
  lines: z.array(journalLine),
});

export const entriesQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  source: journalSourceEnum.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const entryBody = z.object({
  date: isoDate,
  label: z.string().trim().min(1).max(200),
  lines: z
    .array(
      z.object({
        accountId: uuid,
        debit: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0'),
        credit: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0'),
        label: z.string().trim().max(200).nullish(),
      }),
    )
    .min(2),
});

export const periodQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

export const ledgerQuery = periodQuery.extend({ accountId: uuid });

export const ledgerResponse = z.object({
  account: z.object({ id: uuid, code: z.string(), name: z.string(), type: accountTypeEnum }),
  /** debit - credit before `from`. */
  opening: decimalString,
  lines: z.array(
    z.object({
      date: isoDate,
      entryId: uuid,
      seq: z.number().int(),
      label: z.string(),
      debit: decimalString,
      credit: decimalString,
      balance: decimalString,
    }),
  ),
  debit: decimalString,
  credit: decimalString,
  closing: decimalString,
});

export const trialRow = z.object({
  accountId: uuid,
  code: z.string(),
  name: z.string(),
  type: accountTypeEnum,
  opening: decimalString,
  debit: decimalString,
  credit: decimalString,
  closing: decimalString,
});

export const trialBalanceResponse = z.object({
  rows: z.array(trialRow),
  totals: z.object({ debit: decimalString, credit: decimalString }),
  /** Income minus expenses over the period. */
  result: z.object({ income: decimalString, expense: decimalString, net: decimalString }),
  balanced: z.boolean(),
});

export const syncResult = z.object({ posted: z.number().int(), reversed: z.number().int() });

export type Account = z.infer<typeof account>;
export type JournalEntry = z.infer<typeof journalEntry>;
