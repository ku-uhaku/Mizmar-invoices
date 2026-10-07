import { z } from 'zod';
import { currencyCode, decimalInput, decimalString, isoDate, uuid } from './common';

// ---------------------------------------------------------------------------
// Price lists
// ---------------------------------------------------------------------------

export const priceListItem = z.object({
  id: uuid,
  priceListId: uuid,
  variantId: uuid,
  sku: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  price: decimalString,
  /** Tier: applies from this quantity (0 = base price of the list). */
  minQuantity: decimalString,
  discountPercent: decimalString.nullable(),
});

export const priceList = z.object({
  id: uuid,
  name: z.string(),
  currency: z.string(),
  isActive: z.boolean(),
  validFrom: isoDate.nullable(),
  validTo: isoDate.nullable(),
  /** Default list of the active company. */
  isDefault: z.boolean(),
  itemCount: z.number().int(),
  contactCount: z.number().int(),
});

export const priceListDetail = priceList.extend({
  items: z.array(priceListItem),
  contacts: z.array(z.object({ id: uuid, displayName: z.string() })),
});

export const priceListCreate = z.object({
  name: z.string().min(1).max(120),
  currency: currencyCode.default('MAD'),
  isActive: z.boolean().default(true),
  validFrom: isoDate.nullish(),
  validTo: isoDate.nullish(),
});
export const priceListUpdate = priceListCreate.partial();

export const priceListItemUpsert = z.object({
  variantId: uuid,
  price: decimalInput,
  minQuantity: decimalInput.default('0'),
  discountPercent: decimalInput.nullish(),
});
export const priceListItemUpdate = z.object({
  price: decimalInput.optional(),
  minQuantity: decimalInput.optional(),
  discountPercent: decimalInput.nullish(),
});

export const assignContacts = z.object({
  /** Contacts to attach to the list. */
  contactIds: z.array(uuid),
  /** When true, contacts currently on the list but absent from contactIds are detached. */
  replace: z.boolean().default(false),
});

export const defaultPriceListBody = z.object({ priceListId: uuid.nullable() });
export const defaultPriceListResponse = z.object({ priceListId: uuid.nullable() });

// ---------------------------------------------------------------------------
// Exchange rates (1 base = rate quote)
// ---------------------------------------------------------------------------

export const exchangeRate = z.object({
  id: uuid,
  baseCurrency: z.string(),
  quoteCurrency: z.string(),
  rate: decimalString,
  validFrom: isoDate,
});

export const exchangeRateCreate = z.object({
  baseCurrency: currencyCode,
  quoteCurrency: currencyCode,
  rate: decimalInput,
  validFrom: isoDate,
});
export const exchangeRateUpdate = z.object({
  rate: decimalInput.optional(),
  validFrom: isoDate.optional(),
});

export const exchangeRateListQuery = z.object({
  baseCurrency: currencyCode.optional(),
  quoteCurrency: currencyCode.optional(),
});

export const exchangeRateLookupQuery = z.object({
  base: currencyCode,
  quote: currencyCode,
  /** Defaults to today; falls back to the most recent earlier rate. */
  date: isoDate.optional(),
});

export const exchangeRateLookup = z.object({
  base: z.string(),
  quote: z.string(),
  rate: decimalString,
  /** validFrom of the rate row used; null for same-currency identity. */
  validFrom: isoDate.nullable(),
  inverted: z.boolean(),
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export const resolveQuery = z.object({
  variantId: uuid,
  contactId: uuid.optional(),
  quantity: decimalInput.default('1'),
  /** Currency the caller wants the price in; defaults to the company currency. */
  currency: currencyCode.optional(),
  date: isoDate.optional(),
});

export const resolvedPrice = z.object({
  unitPrice: decimalString,
  currency: z.string(),
  source: z.enum(['CONTACT_LIST', 'DEFAULT_LIST', 'BASE']),
  priceListId: uuid.nullable(),
  discountPercent: decimalString.nullable(),
  /** Set when the price was converted from another currency. */
  conversion: z
    .object({
      from: z.string(),
      rate: decimalString,
      rateDate: isoDate.nullable(),
    })
    .nullable(),
});

export type PriceList = z.infer<typeof priceList>;
export type PriceListDetail = z.infer<typeof priceListDetail>;
export type PriceListItem = z.infer<typeof priceListItem>;
export type ExchangeRate = z.infer<typeof exchangeRate>;
export type ResolvedPrice = z.infer<typeof resolvedPrice>;
