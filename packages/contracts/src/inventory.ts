import { z } from 'zod';
import {
  adjustmentReasonEnum,
  countSessionStatusEnum,
  decimalInput,
  decimalString,
  isoDate,
  isoDateTime,
  movementTypeEnum,
  stockDirectionEnum,
  uuid,
} from './common';

export const warehouse = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  isActive: z.boolean(),
});

export const warehouseCreate = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  address: z.string().max(300).optional(),
  city: z.string().max(100).optional(),
});

/** One row of the stock dashboard grid. */
export const stockRow = z.object({
  variantId: uuid,
  productId: uuid,
  productName: z.string(),
  sku: z.string(),
  barcode: z.string().nullable(),
  variantLabel: z.string().nullable(),
  warehouseId: uuid,
  warehouseCode: z.string(),
  warehouseName: z.string(),
  onHand: decimalString,
  reserved: decimalString,
  available: decimalString,
  incoming: decimalString,
  minStockThreshold: decimalString,
  isLowStock: z.boolean(),
  /** Omitted for roles that may not see cost. */
  averageCost: decimalString.optional(),
  stockValue: decimalString.optional(),
  lastMovementAt: isoDateTime.nullable(),
});

export const stockListQuery = z.object({
  search: z.string().optional(),
  warehouseId: uuid.optional(),
  category: z.string().optional(),
  /** below-threshold | zero | negative | all */
  filter: z.enum(['all', 'low', 'zero', 'negative']).default('all'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const movementRow = z.object({
  id: uuid,
  createdAt: isoDateTime,
  variantId: uuid,
  sku: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  warehouseId: uuid,
  warehouseCode: z.string(),
  type: movementTypeEnum,
  direction: stockDirectionEnum,
  reason: adjustmentReasonEnum.nullable(),
  quantity: decimalString,
  balanceAfter: decimalString,
  unitCost: decimalString.nullable(),
  documentId: uuid.nullable(),
  documentType: z.string().nullable(),
  documentNumber: z.string().nullable(),
  userId: uuid.nullable(),
  userName: z.string().nullable(),
  note: z.string().nullable(),
});

export const movementListQuery = z.object({
  variantId: uuid.optional(),
  warehouseId: uuid.optional(),
  documentId: uuid.optional(),
  userId: uuid.optional(),
  type: movementTypeEnum.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Manual adjustment. `quantity` is a signed delta, not a target: an absolute
 * target would race with a concurrent sale and silently discard it.
 */
export const adjustmentRequest = z.object({
  warehouseId: uuid,
  reason: adjustmentReasonEnum,
  note: z.string().max(1000).optional(),
  lines: z
    .array(
      z.object({
        variantId: uuid,
        quantityDelta: decimalInput,
        unitCost: decimalInput.optional(),
        /** Receiving into a lot (items with lot tracking). */
        lotNumber: z.string().trim().min(1).max(60).optional(),
        expiryDate: isoDate.nullish(),
      }),
    )
    .min(1),
});

export const transferRequest = z.object({
  sourceWarehouseId: uuid,
  destinationWarehouseId: uuid,
  note: z.string().max(1000).optional(),
  lines: z.array(z.object({ variantId: uuid, quantity: decimalInput })).min(1),
});

export const countSessionCreate = z.object({
  warehouseId: uuid,
  isBlind: z.boolean().default(true),
  note: z.string().max(1000).optional(),
  /** Empty means every variant that has ever moved in this warehouse. */
  variantIds: z.array(uuid).optional(),
});

export const countLine = z.object({
  id: uuid,
  variantId: uuid,
  sku: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  /** Hidden while a blind session is still counting. */
  expectedQuantity: decimalString.nullable(),
  countedQuantity: decimalString.nullable(),
  variance: decimalString.nullable(),
  note: z.string().nullable(),
  countedAt: isoDateTime.nullable(),
});

export const countSession = z.object({
  id: uuid,
  reference: z.string(),
  warehouseId: uuid,
  warehouseName: z.string(),
  isBlind: z.boolean(),
  status: countSessionStatusEnum,
  note: z.string().nullable(),
  startedAt: isoDateTime,
  postedAt: isoDateTime.nullable(),
  startedByName: z.string().nullable(),
  lines: z.array(countLine),
  varianceCount: z.number().int(),
});

export const countSubmitRequest = z.object({
  lines: z
    .array(
      z.object({
        variantId: uuid,
        countedQuantity: decimalInput,
        note: z.string().max(500).optional(),
      }),
    )
    .min(1),
});

export const availabilityQuery = z.object({
  variantIds: z.array(uuid).min(1),
  warehouseId: uuid.optional(),
});

export const availabilityRow = z.object({
  variantId: uuid,
  warehouseId: uuid,
  onHand: decimalString,
  reserved: decimalString,
  available: decimalString,
});

export type StockRow = z.infer<typeof stockRow>;
export type MovementRow = z.infer<typeof movementRow>;
export type AdjustmentRequest = z.infer<typeof adjustmentRequest>;
