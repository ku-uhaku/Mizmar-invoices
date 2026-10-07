import { z } from 'zod';
import { decimalString, isoDate, uuid } from './common';

/**
 * Report endpoints are plain HTTP (not ts-rest) because `?format=csv` returns a
 * file rather than JSON. These schemas validate the query on the server and
 * type the JSON on the client.
 */
export const reportFormat = z.enum(['json', 'csv']).default('json');
export const csvDecimal = z.enum(['dot', 'comma']).default('dot');

const range = {
  from: isoDate,
  to: isoDate,
  format: reportFormat,
  decimal: csvDecimal,
};

export const salesReportQuery = z.object({
  ...range,
  groupBy: z.enum(['period', 'customer', 'product']).default('period'),
  period: z.enum(['day', 'week', 'month']).default('month'),
});

export const salesReportRow = z.object({
  key: z.string(),
  label: z.string(),
  documentCount: z.number().int(),
  quantity: decimalString.nullable(),
  totalExclVat: decimalString,
  totalVat: decimalString,
  totalInclVat: decimalString,
});

export const salesReportResponse = z.object({
  currency: z.string(),
  from: isoDate,
  to: isoDate,
  groupBy: z.enum(['period', 'customer', 'product']),
  rows: z.array(salesReportRow),
  totals: z.object({
    totalExclVat: decimalString,
    totalVat: decimalString,
    totalInclVat: decimalString,
  }),
});

export const vatReportQuery = z.object(range);

export const vatReportRow = z.object({
  rate: decimalString,
  base: decimalString,
  vat: decimalString,
});

export const vatReportSide = z.object({
  rows: z.array(vatReportRow),
  totalBase: decimalString,
  totalVat: decimalString,
});

export const vatReportResponse = z.object({
  currency: z.string(),
  from: isoDate,
  to: isoDate,
  sales: vatReportSide,
  purchases: vatReportSide,
  /** Output VAT minus deductible input VAT; negative means a VAT credit. */
  netVatDue: decimalString,
});

export const statementReportQuery = z.object({
  contactId: uuid,
  party: z.enum(['customer', 'supplier']).default('customer'),
  ...range,
});

export const statementReportRow = z.object({
  date: isoDate,
  kind: z.enum(['DOCUMENT', 'PAYMENT']),
  reference: z.string(),
  label: z.string(),
  debit: decimalString,
  credit: decimalString,
  balance: decimalString,
});

export const statementReportResponse = z.object({
  currency: z.string(),
  contactId: uuid,
  contactName: z.string(),
  party: z.enum(['customer', 'supplier']),
  from: isoDate,
  to: isoDate,
  openingBalance: decimalString,
  closingBalance: decimalString,
  totalDebit: decimalString,
  totalCredit: decimalString,
  rows: z.array(statementReportRow),
});

export const stockValuationQuery = z.object({
  warehouseId: uuid.optional(),
  format: reportFormat,
  decimal: csvDecimal,
});

export const stockValuationRow = z.object({
  warehouseCode: z.string(),
  warehouseName: z.string(),
  variantId: uuid,
  sku: z.string(),
  productName: z.string(),
  variantLabel: z.string().nullable(),
  onHand: decimalString,
  averageCost: decimalString,
  value: decimalString,
});

export const stockValuationResponse = z.object({
  currency: z.string(),
  rows: z.array(stockValuationRow),
  warehouseTotals: z.array(
    z.object({ warehouseCode: z.string(), warehouseName: z.string(), value: decimalString }),
  ),
  totalValue: decimalString,
});

export type SalesReportResponse = z.infer<typeof salesReportResponse>;
export type VatReportResponse = z.infer<typeof vatReportResponse>;
export type StatementReportResponse = z.infer<typeof statementReportResponse>;
export type StockValuationResponse = z.infer<typeof stockValuationResponse>;
