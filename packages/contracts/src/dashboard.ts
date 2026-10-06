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
