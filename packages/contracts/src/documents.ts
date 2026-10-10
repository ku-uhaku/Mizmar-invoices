import { z } from 'zod';
import {
  badgeSchema,
  currencyCode,
  decimalInput,
  decimalString,
  discountKindEnum,
  discountSchema,
  documentSideEnum,
  documentTypeEnum,
  fulfilmentEnum,
  isoDate,
  isoDateTime,
  lifecycleEnum,
  localeEnum,
  priceModeEnum,
  settlementEnum,
  totalsSchema,
  uuid,
  vatBucketSchema,
} from './common';

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export const documentLineSource = z.object({
  sourceDocumentId: uuid,
  sourceDocumentType: documentTypeEnum,
  sourceDocumentNumber: z.string().nullable(),
  sourceLineId: uuid,
  quantity: decimalString,
});

export const documentLine = z.object({
  id: uuid,
  variantId: uuid.nullable(),
  warehouseId: uuid.nullable(),
  sku: z.string().nullable(),
  description: z.string(),
  variantLabel: z.string().nullable(),
  unitCode: z.string().nullable(),
  quantity: decimalString,
  unitPrice: decimalString,
  unitCost: decimalString.nullable(),
  vatRate: decimalString,
  discountKind: discountKindEnum.nullable(),
  discountValue: decimalString.nullable(),
  lineGross: decimalString,
  lineDiscount: decimalString,
  lineNet: decimalString,
  globalDiscountShare: decimalString,
  taxableBase: decimalString,
  vatAmount: decimalString,
  lineTotal: decimalString,
  /** How much downstream documents have drawn; drives remaining quantity. */
  drawnQuantity: decimalString,
  remainingQuantity: decimalString,
  isNote: z.boolean(),
  isService: z.boolean(),
  sortOrder: z.number().int(),
  sources: z.array(documentLineSource),
  /** Live availability, so the editor can warn before validation. */
  available: decimalString.optional(),
  isLowStock: z.boolean().optional(),
});

export const documentLineInput = z.object({
  id: uuid.optional(),
  variantId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  /** Editable, and defaulted from the variant when omitted. */
  description: z.string().max(500).optional(),
  quantity: decimalInput,
  unitPrice: decimalInput.optional(),
  unitCost: decimalInput.nullish(),
  vatRate: decimalInput.optional(),
  discount: discountSchema.nullish(),
  isNote: z.boolean().default(false),
  isService: z.boolean().default(false),
  sortOrder: z.number().int().optional(),
  /** Set by a conversion, not by hand. */
  sources: z
    .array(z.object({ sourceLineId: uuid, quantity: decimalInput }))
    .optional(),
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentLinks = z.object({
  convertedFrom: z.array(
    z.object({
      id: uuid,
      type: documentTypeEnum,
      number: z.string().nullable(),
      issueDate: isoDate,
    }),
  ),
  convertedTo: z.array(
    z.object({
      id: uuid,
      type: documentTypeEnum,
      number: z.string().nullable(),
      issueDate: isoDate,
      lifecycle: lifecycleEnum,
    }),
  ),
});

export const documentDetail = z.object({
  id: uuid,
  companyId: uuid,
  type: documentTypeEnum,
  side: documentSideEnum,
  /** Null until validation; the UI shows `draftLabel` instead. */
  number: z.string().nullable(),
  draftLabel: z.string().nullable(),
  lifecycle: lifecycleEnum,
  fulfilment: fulfilmentEnum,
  settlement: settlementEnum,
  badges: z.array(badgeSchema),
  isOverdue: z.boolean(),
  isEditable: z.boolean(),
  canCancel: z.boolean(),
  conversionTargets: z.array(documentTypeEnum),

  contactId: uuid,
  contactName: z.string(),
  contactIce: z.string().nullable(),
  billingAddressId: uuid.nullable(),
  shippingAddressId: uuid.nullable(),
  warehouseId: uuid.nullable(),

  issueDate: isoDate,
  dueDate: isoDate.nullable(),
  validUntil: isoDate.nullable(),
  deliveryDate: isoDate.nullable(),

  currency: z.string(),
  exchangeRate: decimalString,
  locale: localeEnum.nullable(),
  priceMode: priceModeEnum,

  globalDiscountKind: discountKindEnum.nullable(),
  globalDiscountValue: decimalString.nullable(),
  shippingAmount: decimalString.nullable(),
  shippingVatRate: decimalString.nullable(),

  totals: totalsSchema,
  /** Totals converted to the company currency with the snapshotted exchangeRate, for reporting. */
  baseTotals: z
    .object({ totalExclVat: decimalString, totalVat: decimalString, totalInclVat: decimalString })
    .optional(),
  vatBreakdown: z.array(vatBucketSchema),
  paidAmount: decimalString,
  outstandingAmount: decimalString,
  returnToStock: z.boolean(),

  reference: z.string().nullable(),
  projectName: z.string().nullable(),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  internalMemo: z.string().nullable(),
  templateConfigId: uuid.nullable(),

  lines: z.array(documentLine),
  links: documentLinks,

  createdById: uuid.nullable(),
  createdByName: z.string().nullable(),
  validatedAt: isoDateTime.nullable(),
  sentAt: isoDateTime.nullable(),
  cancelledAt: isoDateTime.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const documentListRow = z.object({
  id: uuid,
  type: documentTypeEnum,
  number: z.string().nullable(),
  draftLabel: z.string().nullable(),
  issueDate: isoDate,
  dueDate: isoDate.nullable(),
  contactId: uuid,
  contactName: z.string(),
  currency: z.string(),
  totalExclVat: decimalString,
  totalInclVat: decimalString,
  paidAmount: decimalString,
  outstandingAmount: decimalString,
  lifecycle: lifecycleEnum,
  fulfilment: fulfilmentEnum,
  settlement: settlementEnum,
  isOverdue: z.boolean(),
  badges: z.array(badgeSchema),
  createdByName: z.string().nullable(),
});

export const documentCreate = z.object({
  type: documentTypeEnum,
  contactId: uuid,
  billingAddressId: uuid.nullish(),
  shippingAddressId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  issueDate: isoDate.optional(),
  dueDate: isoDate.nullish(),
  validUntil: isoDate.nullish(),
  deliveryDate: isoDate.nullish(),
  currency: currencyCode.optional(),
  exchangeRate: decimalInput.optional(),
  locale: localeEnum.nullish(),
  priceMode: priceModeEnum.optional(),
  globalDiscount: discountSchema.nullish(),
  shippingAmount: decimalInput.nullish(),
  shippingVatRate: decimalInput.nullish(),
  returnToStock: z.boolean().optional(),
  reference: z.string().max(100).nullish(),
  projectName: z.string().max(200).nullish(),
  notes: z.string().max(5000).nullish(),
  terms: z.string().max(5000).nullish(),
  internalMemo: z.string().max(5000).nullish(),
  templateConfigId: uuid.nullish(),
  lines: z.array(documentLineInput).default([]),
});

/** A draft is replaced wholesale, which is how the editor's autosave behaves. */
export const documentUpdate = documentCreate.omit({ type: true }).partial();

export const documentListQuery = z.object({
  type: documentTypeEnum.optional(),
  side: documentSideEnum.optional(),
  lifecycle: lifecycleEnum.optional(),
  settlement: settlementEnum.optional(),
  fulfilment: fulfilmentEnum.optional(),
  contactId: uuid.optional(),
  createdById: uuid.optional(),
  search: z.string().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  minTotal: decimalInput.optional(),
  maxTotal: decimalInput.optional(),
  overdueOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Validation and conversion
// ---------------------------------------------------------------------------

export const stockPreviewRow = z.object({
  variantId: uuid,
  sku: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  warehouseId: uuid,
  warehouseCode: z.string(),
  direction: z.enum(['IN', 'OUT']),
  quantity: decimalString,
  onHandBefore: decimalString,
  onHandAfter: decimalString,
});

export const shortfallRow = z.object({
  variantId: uuid,
  sku: z.string(),
  productName: z.string(),
  warehouseId: uuid,
  warehouseCode: z.string(),
  requested: decimalString,
  available: decimalString,
  shortBy: decimalString,
});

/**
 * What the validation dialog shows before anything is written: the exact
 * ledger rows about to be created, plus any shortfall.
 */
export const validationPreview = z.object({
  documentId: uuid,
  willAllocateNumber: z.boolean(),
  nextNumberPreview: z.string().nullable(),
  movements: z.array(stockPreviewRow),
  reservations: z.array(
    z.object({
      variantId: uuid,
      sku: z.string(),
      warehouseId: uuid,
      action: z.enum(['HOLD', 'RELEASE']),
      quantity: decimalString,
    }),
  ),
  shortfalls: z.array(shortfallRow),
  blocked: z.boolean(),
  requiresConfirmation: z.boolean(),
  totals: totalsSchema,
});

export const validateRequest = z.object({
  /** Required when the preview reported `requiresConfirmation` under WARN. */
  confirmNegativeStock: z.boolean().default(false),
});

export const cancelRequest = z.object({
  reason: z.string().min(1).max(500),
});

/** One row of the conversion dialog. */
export const convertibleLineRow = z.object({
  sourceDocumentId: uuid,
  sourceDocumentNumber: z.string().nullable(),
  sourceLineId: uuid,
  variantId: uuid.nullable(),
  sku: z.string().nullable(),
  description: z.string(),
  variantLabel: z.string().nullable(),
  ordered: decimalString,
  alreadyDrawn: decimalString,
  remaining: decimalString,
  unitPrice: decimalString,
  vatRate: decimalString,
});

export const conversionOptions = z.object({
  targetType: documentTypeEnum,
  sources: z.array(
    z.object({
      documentId: uuid,
      documentType: documentTypeEnum,
      number: z.string().nullable(),
      issueDate: isoDate,
    }),
  ),
  lines: z.array(convertibleLineRow),
});

export const convertRequest = z.object({
  /** Several sources at once is how "invoice these three BLs" works. */
  sourceDocumentIds: z.array(uuid).min(1),
  targetType: documentTypeEnum,
  /** Omit to take every line's full remainder. */
  selections: z
    .array(
      z.object({
        sourceDocumentId: uuid,
        sourceLineId: uuid,
        quantity: decimalInput,
      }),
    )
    .optional(),
  issueDate: isoDate.optional(),
  warehouseId: uuid.nullish(),
  returnToStock: z.boolean().optional(),
  /** Validate the result immediately instead of leaving a draft. */
  validateImmediately: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Totals preview, payments, PDF and email
// ---------------------------------------------------------------------------

/**
 * Server-side totals for a document that has not been saved. The editor
 * computes the same figures locally with @mizmar/core for instant feedback;
 * this endpoint is the authority they are reconciled against.
 */
export const totalsPreviewRequest = z.object({
  priceMode: priceModeEnum.optional(),
  globalDiscount: discountSchema.nullish(),
  shippingAmount: decimalInput.nullish(),
  shippingVatRate: decimalInput.nullish(),
  lines: z.array(
    z.object({
      id: z.string(),
      quantity: decimalInput,
      unitPrice: decimalInput,
      vatRate: decimalInput,
      discount: discountSchema.nullish(),
      isNote: z.boolean().optional(),
    }),
  ),
});

export const totalsPreviewResponse = totalsSchema.extend({
  lines: z.array(
    z.object({
      id: z.string(),
      gross: decimalString,
      lineDiscount: decimalString,
      net: decimalString,
      globalDiscountShare: decimalString,
      taxableBase: decimalString,
      vatRate: decimalString,
      vatAmount: decimalString,
      total: decimalString,
    }),
  ),
});

export const paymentCreate = z.object({
  contactId: uuid,
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'BILL_OF_EXCHANGE', 'CARD', 'OTHER']),
  reference: z.string().max(100).optional(),
  amount: decimalInput,
  currency: currencyCode.optional(),
  exchangeRate: decimalInput.optional(),
  paidAt: isoDate,
  clearedAt: isoDate.nullish(),
  note: z.string().max(1000).optional(),
  /** Set by the till: the open cash session this payment belongs to. */
  cashSessionId: uuid.nullish(),
  /** Omit amounts to settle oldest-first automatically. */
  allocations: z
    .array(z.object({ documentId: uuid, amount: decimalInput.optional() }))
    .min(1),
});

/**
 * Correct a recorded payment. Every field is optional. `allocations`, when
 * sent, replaces the whole split; omit it to leave the split as it is (a
 * payment with a single allocation follows an amount change automatically).
 */
export const paymentUpdate = z.object({
  method: paymentCreate.shape.method.optional(),
  reference: z.string().max(100).nullish(),
  amount: decimalInput.optional(),
  paidAt: isoDate.optional(),
  clearedAt: isoDate.nullish(),
  note: z.string().max(1000).nullish(),
  allocations: z
    .array(z.object({ documentId: uuid, amount: decimalInput.optional() }))
    .min(1)
    .optional(),
});

export const payment = z.object({
  id: uuid,
  contactId: uuid,
  contactName: z.string(),
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  method: z.string(),
  reference: z.string().nullable(),
  amount: decimalString,
  currency: z.string(),
  paidAt: isoDate,
  clearedAt: isoDate.nullable(),
  note: z.string().nullable(),
  allocations: z.array(
    z.object({
      documentId: uuid,
      documentNumber: z.string().nullable(),
      documentType: documentTypeEnum,
      amount: decimalString,
    }),
  ),
});

export const pdfRenderRequest = z.object({
  locale: localeEnum.optional(),
  templateConfigId: uuid.nullish(),
  /** Re-render under the current template instead of serving the snapshot. */
  forceRerender: z.boolean().default(false),
});

export const pdfRenderResponse = z.object({
  documentId: uuid,
  snapshotVersion: z.number().int(),
  url: z.string(),
  fileName: z.string(),
  byteSize: z.number().int(),
  cached: z.boolean(),
});

export const sendEmailRequest = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20000),
  locale: localeEnum.optional(),
  attachPdf: z.boolean().default(true),
});

export type DocumentDetail = z.infer<typeof documentDetail>;
export type DocumentListRow = z.infer<typeof documentListRow>;
export type DocumentCreate = z.infer<typeof documentCreate>;
export type ConvertRequest = z.infer<typeof convertRequest>;
export type ValidationPreview = z.infer<typeof validationPreview>;
