import { z } from 'zod';
import { decimalInput, decimalString, uuid } from './common';

export const attributeValue = z.object({
  id: uuid,
  value: z.string(),
  colorHex: z.string().nullable(),
  sortOrder: z.number().int(),
});

export const attributeType = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  values: z.array(attributeValue),
});

export const attributeTypeCreate = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().default(0),
  values: z
    .array(
      z.object({
        value: z.string().min(1).max(100),
        colorHex: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        sortOrder: z.number().int().default(0),
      }),
    )
    .default([]),
});

export const variantAttribute = z.object({
  attributeTypeId: uuid,
  attributeTypeName: z.string(),
  attributeValueId: uuid,
  value: z.string(),
  colorHex: z.string().nullable(),
});

export const productVariant = z.object({
  id: uuid,
  productId: uuid,
  sku: z.string(),
  barcode: z.string().nullable(),
  variantLabel: z.string().nullable(),
  /** Omitted entirely for roles that may not see cost. */
  costPrice: decimalString.optional(),
  averageCost: decimalString.optional(),
  sellingPrice: decimalString.optional(),
  minStockThreshold: decimalString,
  weightGrams: z.number().int().nullable(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  attributes: z.array(variantAttribute),
});

export const variantInput = z.object({
  id: uuid.optional(),
  sku: z.string().min(1).max(64),
  barcode: z.string().max(64).optional(),
  /** The attribute values that define this combination. */
  attributeValueIds: z.array(uuid).default([]),
  costPrice: decimalInput.default('0'),
  sellingPrice: decimalInput.default('0'),
  minStockThreshold: decimalInput.default('0'),
  weightGrams: z.number().int().min(0).optional(),
  /** Opening stock per warehouse, written as an OPENING_BALANCE ledger row. */
  openingStock: z
    .array(z.object({ warehouseId: uuid, quantity: decimalInput }))
    .optional(),
  isActive: z.boolean().default(true),
});

export const product = z.object({
  id: uuid,
  name: z.string(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  brand: z.string().nullable(),
  unitId: uuid.nullable(),
  unitCode: z.string().nullable(),
  defaultVatRate: decimalString,
  isVariantManaged: z.boolean(),
  isService: z.boolean(),
  isActive: z.boolean(),
  attributeTypeIds: z.array(uuid),
  variants: z.array(productVariant),
  imageUrls: z.array(z.string()),
  /** Rolled up across every warehouse, for the product list. */
  totalOnHand: decimalString.optional(),
  lowStockVariantCount: z.number().int().optional(),
});

export const productCreate = z.object({
  name: z.string().min(1).max(200),
  reference: z.string().max(64).optional(),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  unitId: uuid.optional(),
  defaultVatRate: decimalInput.default('20'),
  isVariantManaged: z.boolean().default(true),
  isService: z.boolean().default(false),
  attributeTypeIds: z.array(uuid).default([]),
  /**
   * Full variant set. A simple product still gets exactly one variant so that
   * stock, pricing and document lines have a single uniform shape.
   */
  variants: z.array(variantInput).min(1),
});

export const productUpdate = productCreate.partial().extend({
  isActive: z.boolean().optional(),
});

export const productListQuery = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  lowStockOnly: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Build the cross-product of the chosen attribute values, with a suggested SKU
 * per combination. Pure preview: nothing is persisted until the user saves.
 */
export const variantMatrixRequest = z.object({
  skuPrefix: z.string().max(32).optional(),
  /** One entry per dimension, in the order the columns should appear. */
  dimensions: z
    .array(z.object({ attributeTypeId: uuid, attributeValueIds: z.array(uuid).min(1) }))
    .min(1),
  defaults: z
    .object({
      costPrice: decimalInput.optional(),
      sellingPrice: decimalInput.optional(),
      minStockThreshold: decimalInput.optional(),
    })
    .optional(),
});

export const variantMatrixResponse = z.object({
  combinations: z.array(
    z.object({
      suggestedSku: z.string(),
      label: z.string(),
      attributeValueIds: z.array(uuid),
      attributes: z.array(variantAttribute),
      costPrice: decimalString,
      sellingPrice: decimalString,
      minStockThreshold: decimalString,
    }),
  ),
});

/** The document editor's line picker: matches SKU, barcode, name and attributes. */
export const variantSearchQuery = z.object({
  q: z.string().min(1),
  warehouseId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  includeInactive: z.coerce.boolean().optional(),
});

export const variantSearchResult = z.object({
  variantId: uuid,
  productId: uuid,
  productName: z.string(),
  sku: z.string(),
  barcode: z.string().nullable(),
  variantLabel: z.string().nullable(),
  unitCode: z.string().nullable(),
  sellingPrice: decimalString.optional(),
  costPrice: decimalString.optional(),
  vatRate: decimalString,
  imageUrl: z.string().nullable(),
  isService: z.boolean(),
  onHand: decimalString,
  reserved: decimalString,
  available: decimalString,
  minStockThreshold: decimalString,
  isLowStock: z.boolean(),
});

export type Product = z.infer<typeof product>;
export type ProductVariant = z.infer<typeof productVariant>;
export type VariantSearchResult = z.infer<typeof variantSearchResult>;
