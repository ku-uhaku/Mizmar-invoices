import { z } from 'zod';
import { decimalString, isoDate, uuid } from './common';

export const trackingEnum = z.enum(['NONE', 'LOT', 'SERIAL']);

export const lotsQuery = z.object({
  variantId: uuid.optional(),
  warehouseId: uuid.optional(),
  /** `expiring` means within `days` of today (expired lots included). */
  filter: z.enum(['all', 'expired', 'expiring']).default('all'),
  days: z.coerce.number().int().min(1).max(730).default(60),
  search: z.string().trim().max(100).optional(),
});

export const lotItem = z.object({
  id: uuid,
  variantId: uuid,
  productName: z.string(),
  sku: z.string(),
  variantLabel: z.string().nullable(),
  tracking: trackingEnum,
  warehouseId: uuid,
  warehouseName: z.string(),
  lotNumber: z.string(),
  expiryDate: isoDate.nullable(),
  quantity: decimalString,
  /** Negative when expired. */
  daysToExpiry: z.number().int().nullable(),
  /** Quantity at the warehouse's average cost. */
  stockValue: decimalString,
  note: z.string().nullable(),
});

const bucket = z.object({ count: z.number().int(), quantity: decimalString, value: decimalString });

export const lotsResponse = z.object({
  items: z.array(lotItem),
  summary: z.object({ expired: bucket, within30: bucket, within60: bucket, within90: bucket }),
});

export const unassignedItem = z.object({
  variantId: uuid,
  productName: z.string(),
  sku: z.string(),
  variantLabel: z.string().nullable(),
  tracking: trackingEnum,
  warehouseId: uuid,
  warehouseName: z.string(),
  onHand: decimalString,
  assigned: decimalString,
  unassigned: decimalString,
});

export const assignBody = z
  .object({
    variantId: uuid,
    warehouseId: uuid,
    lotNumber: z.string().trim().min(1).max(60).optional(),
    expiryDate: isoDate.nullish(),
    quantity: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
    /** Serial-tracked variants: one number per unit. */
    serials: z.array(z.string().trim().min(1).max(60)).max(500).optional(),
  })
  .refine((v) => (v.serials?.length ?? 0) > 0 || (v.lotNumber && v.quantity), {
    message: 'A lot number and quantity, or a list of serial numbers, is required',
  });

export const lotPatch = z.object({
  lotNumber: z.string().trim().min(1).max(60).optional(),
  expiryDate: isoDate.nullish(),
  note: z.string().max(300).nullish(),
});

export const writeOffBody = z.object({
  quantity: z.string().regex(/^\d+(\.\d{1,6})?$/),
  reason: z.enum(['EXPIRED', 'DAMAGED', 'LOST', 'OTHER']).default('EXPIRED'),
  note: z.string().max(300).optional(),
});

export const traceItem = z.object({
  at: z.string(),
  type: z.string(),
  quantity: decimalString,
  documentId: uuid.nullable(),
  documentNumber: z.string().nullable(),
  documentType: z.string().nullable(),
  contactName: z.string().nullable(),
  note: z.string().nullable(),
});

export const trackedVariant = z.object({
  variantId: uuid,
  productName: z.string(),
  sku: z.string(),
  variantLabel: z.string().nullable(),
  barcode: z.string().nullable(),
  tracking: trackingEnum,
  onHand: decimalString,
});

export const trackedQuery = z.object({
  search: z.string().trim().max(100).optional(),
  trackedOnly: z.coerce.boolean().optional(),
});

export const setTrackingBody = z.object({ variantId: uuid, tracking: trackingEnum });

export const barcodesBody = z.object({ variantIds: z.array(uuid).min(1).max(500) });
export const barcodesResult = z.array(z.object({ variantId: uuid, barcode: z.string() }));

export type LotItem = z.infer<typeof lotItem>;
