import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
//
// Money and quantities cross the wire as decimal *strings*, never numbers.
// JSON numbers are IEEE-754 doubles, so 0.1 + 0.2 and large totals lose
// precision in transit; a string survives Postgres NUMERIC -> JSON -> UI -> JSON
// -> NUMERIC unchanged.
// ---------------------------------------------------------------------------

export const uuid = z.string().uuid();

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export const decimalString = z
  .string()
  .regex(DECIMAL_RE, 'must be a decimal number, e.g. "1234.56"');

export const positiveDecimalString = decimalString.refine((v) => Number(v) > 0, {
  message: 'must be greater than zero',
});

export const nonNegativeDecimalString = decimalString.refine((v) => Number(v) >= 0, {
  message: 'must not be negative',
});

/** Accepts a plain number too, so the editor can post what its inputs hold. */
export const decimalInput = z
  .union([decimalString, z.number().finite()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v));

export const isoDate = z.string().date();
export const isoDateTime = z.string().datetime({ offset: true });

export const currencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. MAD');

export const localeEnum = z.enum(['EN', 'FR', 'AR']);
export type LocaleCode = z.infer<typeof localeEnum>;

// ---------------------------------------------------------------------------
// Domain enums — kept in lockstep with @mizmar/core and the Prisma schema
// ---------------------------------------------------------------------------

export const roleEnum = z.enum(['OWNER', 'ADMIN', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'VIEWER']);

export const documentTypeEnum = z.enum([
  'DEVIS',
  'SALES_ORDER',
  'DELIVERY_NOTE',
  'SALES_INVOICE',
  'CREDIT_NOTE',
  'PURCHASE_ORDER',
  'GOODS_RECEIPT',
  'PURCHASE_INVOICE',
]);

export const documentSideEnum = z.enum(['SALES', 'PURCHASE']);
export const lifecycleEnum = z.enum(['DRAFT', 'VALIDATED', 'SENT', 'CANCELLED']);
export const fulfilmentEnum = z.enum(['NOT_APPLICABLE', 'PENDING', 'PARTIAL', 'COMPLETE']);
export const settlementEnum = z.enum(['NOT_APPLICABLE', 'UNPAID', 'PARTIAL', 'PAID']);
export const discountKindEnum = z.enum(['PERCENT', 'AMOUNT']);
export const priceModeEnum = z.enum(['EXCLUSIVE', 'INCLUSIVE']);
export const contactKindEnum = z.enum(['CLIENT', 'SUPPLIER', 'BOTH']);
export const addressKindEnum = z.enum(['BILLING', 'SHIPPING']);

export const paymentTermEnum = z.enum([
  'IMMEDIATE',
  'NET_15',
  'NET_30',
  'NET_45',
  'NET_60',
  'NET_90',
  'END_OF_MONTH',
  'END_OF_NEXT_MONTH',
  'CUSTOM',
]);

export const paymentMethodEnum = z.enum([
  'CASH',
  'BANK_TRANSFER',
  'CHEQUE',
  'BILL_OF_EXCHANGE',
  'CARD',
  'OTHER',
]);

export const paymentDirectionEnum = z.enum(['INBOUND', 'OUTBOUND']);
export const stockDirectionEnum = z.enum(['IN', 'OUT']);

export const movementTypeEnum = z.enum([
  'OPENING_BALANCE',
  'SALE',
  'SALE_RETURN',
  'PURCHASE',
  'PURCHASE_RETURN',
  'ADJUSTMENT',
  'COUNT_CORRECTION',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'CANCELLATION',
]);

export const adjustmentReasonEnum = z.enum([
  'DAMAGED',
  'LOST',
  'SHRINKAGE',
  'EXPIRED',
  'FOUND',
  'COUNT_VARIANCE',
  'CORRECTION',
  'OTHER',
]);

export const negativeStockPolicyEnum = z.enum(['BLOCK', 'WARN', 'ALLOW']);
export const roundingModeEnum = z.enum(['HALF_UP', 'HALF_DOWN', 'HALF_EVEN', 'UP', 'DOWN']);
export const roundingGranularityEnum = z.enum(['LINE', 'DOCUMENT']);
export const countSessionStatusEnum = z.enum(['OPEN', 'COUNTING', 'REVIEW', 'POSTED', 'ABANDONED']);

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export const discountSchema = z.object({
  kind: discountKindEnum,
  value: decimalInput,
});
export type Discount = z.infer<typeof discountSchema>;

/** Cursor paging: stable under inserts, unlike offset paging on a busy list. */
export const paginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().optional(),
  });
}

export const errorBody = z.object({
  statusCode: z.number().int(),
  /** Machine-readable code, e.g. QUANTITY_EXCEEDS_REMAINDER. */
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ErrorBody = z.infer<typeof errorBody>;

export const validationErrorBody = errorBody.extend({
  fieldErrors: z.record(z.array(z.string())).optional(),
});

/** Every mutating route answers these; declared once and spread into each. */
export const commonErrorResponses = {
  400: validationErrorBody,
  401: errorBody,
  403: errorBody,
  404: errorBody,
  409: errorBody,
  422: errorBody,
};

export const vatBucketSchema = z.object({
  rate: decimalString,
  base: decimalString,
  amount: decimalString,
});

export const totalsSchema = z.object({
  subtotalGross: decimalString,
  totalLineDiscounts: decimalString,
  subtotalNet: decimalString,
  globalDiscount: decimalString,
  shippingNet: decimalString,
  totalExclVat: decimalString,
  vatBuckets: z.array(vatBucketSchema),
  totalVat: decimalString,
  totalInclVat: decimalString,
});

export const badgeSchema = z.object({
  key: z.string(),
  tone: z.enum(['neutral', 'info', 'progress', 'success', 'danger']),
  labelKey: z.string(),
});
