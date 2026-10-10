import { z } from 'zod';
import { decimalString, documentTypeEnum, isoDate, isoDateTime, uuid } from './common';

export const dashboardQuery = z.object({
  /** Defaults to the current month. */
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const dashboardResponse = z.object({
  currency: z.string(),
  sales: z.object({
    today: decimalString,
    period: decimalString,
    invoicedPeriod: decimalString,
    /** Same measure over the equally long period just before, for the delta badge. */
    previousInvoiced: decimalString,
    collectedPeriod: decimalString,
    documentCount: z.number().int(),
  }),
  receivables: z.object({
    outstanding: decimalString,
    overdue: decimalString,
    overdueDocumentCount: z.number().int(),
  }),
  stock: z.object({
    lowStockVariantCount: z.number().int(),
    outOfStockVariantCount: z.number().int(),
    totalStockValue: decimalString.optional(),
  }),
  pending: z.object({
    draftDocumentCount: z.number().int(),
    ordersAwaitingDelivery: z.number().int(),
    deliveriesAwaitingInvoice: z.number().int(),
  }),
  salesTrend: z.array(z.object({ date: isoDate, total: decimalString })),
  /** Cash received per day over the same 30 days as `salesTrend`. */
  collectedTrend: z.array(z.object({ date: isoDate, total: decimalString })),
  /** Last six calendar months, oldest first; `month` is YYYY-MM. */
  monthlyTrend: z.array(z.object({ month: z.string(), total: decimalString })),
  receivablesAging: z.array(
    z.object({
      bucket: z.enum(['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS']),
      amount: decimalString,
      count: z.number().int(),
    }),
  ),
  topProducts: z.array(
    z.object({
      sku: z.string().nullable(),
      description: z.string(),
      quantity: decimalString,
      total: decimalString,
    }),
  ),
  topClients: z.array(
    z.object({ contactId: uuid, contactName: z.string(), total: decimalString }),
  ),
  lowStockAlerts: z.array(
    z.object({
      variantId: uuid,
      sku: z.string(),
      productName: z.string(),
      variantLabel: z.string().nullable(),
      warehouseCode: z.string(),
      onHand: decimalString,
      minStockThreshold: decimalString,
    }),
  ),
  recentActivity: z.array(
    z.object({
      at: isoDateTime,
      kind: z.enum(['DOCUMENT', 'PAYMENT', 'STOCK']),
      documentId: uuid.nullable(),
      documentType: documentTypeEnum.nullable(),
      label: z.string(),
      amount: decimalString.nullable(),
      userName: z.string().nullable(),
    }),
  ),
});

export type DashboardResponse = z.infer<typeof dashboardResponse>;
