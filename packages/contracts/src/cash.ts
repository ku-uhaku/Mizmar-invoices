import { z } from 'zod';
import {
  decimalString,
  isoDate,
  isoDateTime,
  nonNegativeDecimalString,
  paymentMethodEnum,
  positiveDecimalString,
  uuid,
} from './common';

export const cashSessionStatusEnum = z.enum(['OPEN', 'CLOSED']);
export const cashMovementTypeEnum = z.enum(['IN', 'OUT']);
export const cashMovementReasonEnum = z.enum(['DEPOSIT', 'WITHDRAWAL', 'EXPENSE', 'REFUND', 'OTHER']);

// -- Registers ---------------------------------------------------------------

export const registerBody = z.object({
  name: z.string().min(1).max(60),
  isActive: z.boolean().default(true),
});

export const register = z.object({
  id: uuid,
  name: z.string(),
  isActive: z.boolean(),
  /** The session currently open on this register, if any. */
  openSession: z
    .object({ id: uuid, number: z.number().int(), openedAt: isoDateTime, openedByName: z.string() })
    .nullable(),
});

// -- Sessions ----------------------------------------------------------------

export const sessionOpen = z.object({
  registerId: uuid,
  openingFloat: nonNegativeDecimalString,
  note: z.string().max(300).nullish(),
});

export const sessionClose = z.object({
  countedCash: nonNegativeDecimalString,
  note: z.string().max(300).nullish(),
});

export const movementCreate = z.object({
  type: cashMovementTypeEnum,
  reason: cashMovementReasonEnum.default('OTHER'),
  amount: positiveDecimalString,
  note: z.string().max(300).nullish(),
});

export const movement = z.object({
  id: uuid,
  type: cashMovementTypeEnum,
  reason: cashMovementReasonEnum,
  amount: decimalString,
  note: z.string().nullable(),
  createdByName: z.string(),
  createdAt: isoDateTime,
});

export const methodTotal = z.object({
  method: paymentMethodEnum,
  count: z.number().int(),
  amount: decimalString,
});

export const sessionSummary = z.object({
  id: uuid,
  number: z.number().int(),
  registerId: uuid,
  registerName: z.string(),
  status: cashSessionStatusEnum,
  openedAt: isoDateTime,
  openedByName: z.string(),
  closedAt: isoDateTime.nullable(),
  closedByName: z.string().nullable(),
  openingFloat: decimalString,
  salesTotal: decimalString,
  salesCount: z.number().int(),
  expectedCash: decimalString,
  countedCash: decimalString.nullable(),
  difference: decimalString.nullable(),
});

/** The Z report: everything that happened during one session. */
export const sessionDetail = sessionSummary.extend({
  openingNote: z.string().nullable(),
  closingNote: z.string().nullable(),
  currency: z.string(),
  byMethod: z.array(methodTotal),
  cashSales: decimalString,
  cashIn: decimalString,
  cashOut: decimalString,
  movements: z.array(movement),
  sales: z.array(
    z.object({
      paymentId: uuid,
      paidAt: isoDate,
      time: isoDateTime,
      method: paymentMethodEnum,
      amount: decimalString,
      documentNumbers: z.array(z.string()),
    }),
  ),
});

export const sessionListQuery = z.object({
  registerId: uuid.optional(),
  status: cashSessionStatusEnum.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type Register = z.infer<typeof register>;
export type SessionSummary = z.infer<typeof sessionSummary>;
export type SessionDetail = z.infer<typeof sessionDetail>;
export type CashMovement = z.infer<typeof movement>;
