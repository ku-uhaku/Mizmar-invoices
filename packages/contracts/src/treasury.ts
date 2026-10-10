import { z } from 'zod';
import { isoDate, uuid } from './common';
import { payment } from './documents';

export const paymentKindEnum = z.enum([
  'CASH',
  'BANK_TRANSFER',
  'CHEQUE',
  'BILL_OF_EXCHANGE',
  'CARD',
  'OTHER',
]);

export const paymentStatusEnum = z.enum(['PENDING', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED']);

export const paymentMethod = z.object({
  id: uuid,
  name: z.string(),
  kind: paymentKindEnum,
  requiresReference: z.boolean(),
  deferred: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});

export const paymentMethodBody = z.object({
  name: z.string().trim().min(1).max(60),
  kind: paymentKindEnum,
  requiresReference: z.boolean().default(false),
  deferred: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const chequeListQuery = z.object({
  status: paymentStatusEnum.optional(),
  direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
  search: z.string().trim().max(100).optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
});

export const chequeSummaryRow = z.object({
  count: z.number().int(),
  amount: z.string(),
});

export const chequeListResponse = z.object({
  items: z.array(payment),
  /** Per status, over the whole filter (direction/search/due), ignoring `status`. */
  summary: z.object({
    PENDING: chequeSummaryRow,
    DEPOSITED: chequeSummaryRow,
    CLEARED: chequeSummaryRow,
    BOUNCED: chequeSummaryRow,
    CANCELLED: chequeSummaryRow,
  }),
});

export const paymentStatusChange = z.object({
  status: paymentStatusEnum,
  /** Effective date (deposit or clearing); defaults to today. */
  date: isoDate.optional(),
  note: z.string().max(500).optional(),
});

export const paymentStatusEvent = z.object({
  id: uuid,
  status: paymentStatusEnum,
  at: z.string(),
  note: z.string().nullable(),
  userName: z.string().nullable(),
});

export type PaymentMethodDto = z.infer<typeof paymentMethod>;
