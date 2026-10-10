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

// ---------------------------------------------------------------------------
// Generic table reports
//
// Most analytic reports are "a few columns, a list of rows, maybe a totals
// line", so they share one response shape and one web view. Column labels are
// French source text (translated by the UI); `label`-typed cells are enum-like
// values the UI translates too.
// ---------------------------------------------------------------------------

export const tableColumnType = z.enum(['text', 'label', 'money', 'qty', 'int', 'percent', 'date']);

export const tableColumn = z.object({
  key: z.string(),
  label: z.string(),
  type: tableColumnType,
});

export const tableCell = z.union([z.string(), z.number(), z.null()]);

export const tableReportResponse = z.object({
  currency: z.string(),
  from: isoDate.nullable(),
  to: isoDate.nullable(),
  columns: z.array(tableColumn),
  rows: z.array(z.record(tableCell)),
  totals: z.record(tableCell).nullable(),
});

export const tableReportName = z.enum([
  'profit-loss',
  'cash-flow',
  'payments-by-method',
  'payables-ageing',
  'margin',
  'purchases',
  'stock-movements',
  'low-stock',
  'slow-movers',
  'stock-counts',
  'stock-transfers',
  'cash-up',
  'user-activity',
  'recurring-runs',
  'expenses-by-category',
  'utility-trend',
  'upcoming-bills',
  'headcount',
  'leave-balances',
  'attendance-summary',
  'payroll-register',
  'cnss-declaration',
  'payroll-by-department',
  'ir-annual',
  'cash-sessions',
  'cash-movements',
]);

export const tableReportQuery = z.object({
  /** Defaults to 1 January of the current year. */
  from: isoDate.optional(),
  /** Defaults to today. */
  to: isoDate.optional(),
  format: reportFormat,
  decimal: csvDecimal,
  groupBy: z.string().max(30).optional(),
  period: z.enum(['day', 'week', 'month']).optional(),
  warehouseId: uuid.optional(),
  /** Slow movers: no sale for this many days. */
  days: z.coerce.number().int().min(1).max(3650).default(90),
  /** Expense category kind for the utility trend; defaults to UTILITY. */
  kind: z.string().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export type TableReportResponse = z.infer<typeof tableReportResponse>;
export type TableReportName = z.infer<typeof tableReportName>;
