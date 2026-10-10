import { z } from 'zod';
import { decimalString, isoDate, uuid } from './common';

export const bankLineStatusEnum = z.enum(['UNMATCHED', 'MATCHED', 'IGNORED']);

export const bankAccount = z.object({
  id: uuid,
  name: z.string(),
  bankName: z.string().nullable(),
  iban: z.string().nullable(),
  currency: z.string(),
  openingBalance: decimalString,
  isActive: z.boolean(),
  /** Opening balance plus every imported line. */
  statementBalance: decimalString,
  lineCount: z.number().int(),
  unmatchedCount: z.number().int(),
  unmatchedTotal: decimalString,
  lastLineDate: isoDate.nullable(),
});

export const bankAccountBody = z.object({
  name: z.string().trim().min(1).max(80),
  bankName: z.string().trim().max(80).nullish(),
  iban: z.string().trim().max(40).nullish(),
  currency: z.string().trim().length(3).default('MAD'),
  openingBalance: z.string().regex(/^-?\d+(\.\d{1,2})?$/).default('0'),
  isActive: z.boolean().default(true),
});

export const bankMatchRef = z.object({
  kind: z.enum(['PAYMENT', 'EXPENSE_PAYMENT']),
  id: uuid,
  label: z.string(),
  reference: z.string().nullable(),
  amount: decimalString,
  paidAt: isoDate,
  dueDate: isoDate.nullable(),
});

export const bankLine = z.object({
  id: uuid,
  date: isoDate,
  description: z.string(),
  reference: z.string().nullable(),
  amount: decimalString,
  balance: decimalString.nullable(),
  status: bankLineStatusEnum,
  match: bankMatchRef.nullable(),
});

export const bankLinesQuery = z.object({
  status: bankLineStatusEnum.optional(),
  search: z.string().trim().max(100).optional(),
});

export const bankImportBody = z.object({
  csv: z.string().min(1).max(5 * 1024 * 1024),
});

export const bankImportResult = z.object({
  imported: z.number().int(),
  duplicates: z.number().int(),
  skipped: z.array(z.object({ line: z.number().int(), reason: z.string() })),
  autoMatched: z.number().int(),
});

export const bankCandidate = bankMatchRef.extend({ score: z.number().int() });

export const bankMatchBody = z.object({
  kind: z.enum(['PAYMENT', 'EXPENSE_PAYMENT']),
  id: uuid,
});

export const bankAutoMatchResult = z.object({ matched: z.number().int() });

export type BankAccount = z.infer<typeof bankAccount>;
