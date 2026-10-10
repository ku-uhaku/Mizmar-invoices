import { z } from 'zod';
import {
  addressKindEnum,
  contactKindEnum,
  currencyCode,
  decimalInput,
  decimalString,
  isoDate,
  localeEnum,
  paymentTermEnum,
  uuid,
} from './common';

export const contactAddress = z.object({
  id: uuid,
  kind: addressKindEnum,
  label: z.string().nullable(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  isDefault: z.boolean(),
});

export const contactAddressInput = contactAddress.omit({ id: true }).partial({
  label: true,
  addressLine2: true,
  city: true,
  postalCode: true,
  country: true,
  isDefault: true,
  kind: true,
});

export const contactPerson = z.object({
  id: uuid,
  fullName: z.string(),
  role: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

/**
 * A debt that existed before the app was used. Signed in the contact's natural
 * direction: positive = the client owes you / you owe the supplier, negative =
 * an advance or credit in the other direction.
 */
export const openingBalance = z.object({
  amount: decimalString,
  asOf: isoDate,
  note: z.string().nullable(),
});

export const openingBalanceInput = z.object({
  /** Zero removes the opening balance. */
  amount: decimalInput,
  asOf: isoDate,
  note: z.string().max(500).nullish(),
});

export const contact = z.object({
  id: uuid,
  kind: contactKindEnum,
  code: z.string().nullable(),
  displayName: z.string(),
  legalName: z.string().nullable(),
  // Moroccan tax identity, printed on every document.
  ice: z.string().nullable(),
  rc: z.string().nullable(),
  taxId: z.string().nullable(),
  patente: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  phone2: z.string().nullable(),
  website: z.string().nullable(),
  paymentTerm: paymentTermEnum,
  paymentTermDays: z.number().int().nullable(),
  creditLimit: decimalString.nullable(),
  defaultCurrency: z.string(),
  defaultLocale: localeEnum.nullable(),
  vatExempt: z.boolean(),
  priceListId: uuid.nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  addresses: z.array(contactAddress),
  people: z.array(contactPerson),
  /** Unpaid total across validated documents, for the directory list. */
  outstandingBalance: decimalString.optional(),
  overdueBalance: decimalString.optional(),
  openingBalance: openingBalance.nullable().optional(),
});

export const contactCreate = z.object({
  kind: contactKindEnum.default('CLIENT'),
  code: z.string().max(40).optional(),
  displayName: z.string().min(1).max(200),
  legalName: z.string().max(200).optional(),
  ice: z.string().max(40).optional(),
  rc: z.string().max(40).optional(),
  taxId: z.string().max(40).optional(),
  patente: z.string().max(40).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  phone2: z.string().max(40).optional(),
  website: z.string().max(200).optional(),
  paymentTerm: paymentTermEnum.default('IMMEDIATE'),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
  creditLimit: decimalInput.optional(),
  defaultCurrency: currencyCode.default('MAD'),
  defaultLocale: localeEnum.optional(),
  vatExempt: z.boolean().default(false),
  priceListId: uuid.nullish(),
  notes: z.string().max(5000).optional(),
  addresses: z.array(contactAddressInput).optional(),
  people: z.array(contactPerson.omit({ id: true })).optional(),
});

export const contactUpdate = contactCreate.partial().extend({
  isActive: z.boolean().optional(),
});

export const contactListQuery = z.object({
  search: z.string().optional(),
  kind: contactKindEnum.optional(),
  isActive: z.coerce.boolean().optional(),
  withBalances: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** One line of a client account statement. */
export const statementRow = z.object({
  documentId: uuid,
  documentType: z.string(),
  number: z.string().nullable(),
  issueDate: isoDate,
  dueDate: isoDate.nullable(),
  label: z.string(),
  debit: decimalString,
  credit: decimalString,
  runningBalance: decimalString,
  outstanding: decimalString,
  daysOverdue: z.number().int(),
  ageingBucket: z.enum(['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS']),
});

export const statement = z.object({
  contact,
  companyId: uuid,
  currency: z.string(),
  from: isoDate.nullable(),
  to: isoDate,
  openingBalance: decimalString,
  closingBalance: decimalString,
  totalInvoiced: decimalString,
  totalPaid: decimalString,
  totalOutstanding: decimalString,
  ageing: z.object({
    CURRENT: decimalString,
    D1_30: decimalString,
    D31_60: decimalString,
    D61_90: decimalString,
    D90_PLUS: decimalString,
  }),
  rows: z.array(statementRow),
});

export type Contact = z.infer<typeof contact>;
export type ContactCreate = z.infer<typeof contactCreate>;
export type Statement = z.infer<typeof statement>;
