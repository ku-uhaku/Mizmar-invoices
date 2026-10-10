import { z } from 'zod';
import {
  currencyCode,
  decimalString,
  isoDate,
  isoDateTime,
  nonNegativeDecimalString,
  paymentMethodEnum,
  positiveDecimalString,
  uuid,
} from './common';
import { recurringFrequencyEnum } from './recurring';

export const expenseCategoryKindEnum = z.enum([
  'UTILITY',
  'RENT',
  'INSURANCE',
  'FUEL',
  'SUPPLIES',
  'SALARY',
  'TAX',
  'OTHER',
]);
export const expenseStatusEnum = z.enum(['DRAFT', 'UNPAID', 'PARTIAL', 'PAID', 'CANCELLED']);

// -- Categories --------------------------------------------------------------

export const expenseCategory = z.object({
  id: uuid,
  name: z.string(),
  kind: expenseCategoryKindEnum,
  isActive: z.boolean(),
});

export const expenseCategoryCreate = z.object({
  name: z.string().min(1).max(100),
  kind: expenseCategoryKindEnum.default('OTHER'),
  isActive: z.boolean().default(true),
});

// -- Expenses ----------------------------------------------------------------

const expenseFields = {
  categoryId: uuid,
  supplierId: uuid.nullish(),
  reference: z.string().max(100).nullish(),
  description: z.string().max(500).nullish(),
  issueDate: isoDate,
  dueDate: isoDate.nullish(),
  periodStart: isoDate.nullish(),
  periodEnd: isoDate.nullish(),
  currency: currencyCode.default('MAD'),
  amountExclVat: nonNegativeDecimalString,
  vatRate: nonNegativeDecimalString.default('0'),
  scanAssetId: uuid.nullish(),
  status: z.enum(['DRAFT', 'UNPAID']).default('UNPAID'),
};

export const expenseCreate = z.object(expenseFields);
export const expenseUpdate = z.object(expenseFields).partial();

export const expensePaymentCreate = z.object({
  method: paymentMethodEnum,
  amount: positiveDecimalString,
  paidAt: isoDate,
  reference: z.string().max(100).nullish(),
  note: z.string().max(500).nullish(),
});

export const expensePayment = z.object({
  id: uuid,
  method: paymentMethodEnum,
  amount: decimalString,
  paidAt: isoDate,
  reference: z.string().nullable(),
  note: z.string().nullable(),
});

export const expense = z.object({
  id: uuid,
  categoryId: uuid,
  categoryName: z.string(),
  categoryKind: expenseCategoryKindEnum,
  supplierId: uuid.nullable(),
  supplierName: z.string().nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  issueDate: isoDate,
  dueDate: isoDate.nullable(),
  periodStart: isoDate.nullable(),
  periodEnd: isoDate.nullable(),
  currency: z.string(),
  amountExclVat: decimalString,
  vatRate: decimalString,
  vatAmount: decimalString,
  totalInclVat: decimalString,
  paidAmount: decimalString,
  outstanding: decimalString,
  status: expenseStatusEnum,
  isOverdue: z.boolean(),
  scanAssetId: uuid.nullable(),
  recurringId: uuid.nullable(),
  payments: z.array(expensePayment),
  createdAt: isoDateTime,
});

export const expenseListQuery = z.object({
  categoryId: uuid.optional(),
  kind: expenseCategoryKindEnum.optional(),
  status: expenseStatusEnum.optional(),
  overdue: z.coerce.boolean().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const expenseSummary = z.object({
  currency: z.string(),
  unpaidTotal: decimalString,
  overdueTotal: decimalString,
  overdueCount: z.number().int(),
  dueSoonTotal: decimalString,
  dueSoonCount: z.number().int(),
  monthTotal: decimalString,
});

// -- Recurring expenses ------------------------------------------------------

const recurringExpenseFields = {
  name: z.string().min(1).max(200),
  categoryId: uuid,
  supplierId: uuid.nullish(),
  amountExclVat: nonNegativeDecimalString,
  vatRate: nonNegativeDecimalString.default('0'),
  currency: currencyCode.default('MAD'),
  frequency: recurringFrequencyEnum,
  interval: z.number().int().min(1).max(60).default(1),
  dueInDays: z.number().int().min(0).max(365).default(15),
  startDate: isoDate,
  endDate: isoDate.nullish(),
  isActive: z.boolean().default(true),
};

export const recurringExpenseCreate = z.object(recurringExpenseFields);
export const recurringExpenseUpdate = z.object(recurringExpenseFields).partial();

export const recurringExpense = z.object({
  id: uuid,
  name: z.string(),
  categoryId: uuid,
  categoryName: z.string(),
  supplierId: uuid.nullable(),
  supplierName: z.string().nullable(),
  amountExclVat: decimalString,
  vatRate: decimalString,
  currency: z.string(),
  frequency: recurringFrequencyEnum,
  interval: z.number().int(),
  dueInDays: z.number().int(),
  startDate: isoDate,
  endDate: isoDate.nullable(),
  nextRunAt: isoDate.nullable(),
  isActive: z.boolean(),
});

export const generateResponse = z.object({ generated: z.number().int() });

export type Expense = z.infer<typeof expense>;
export type ExpenseCategory = z.infer<typeof expenseCategory>;
export type RecurringExpense = z.infer<typeof recurringExpense>;
