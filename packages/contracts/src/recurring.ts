import { z } from 'zod';
import { documentCreate } from './documents';
import { isoDate, isoDateTime, uuid } from './common';

export const recurringFrequencyEnum = z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']);
export const recurringModeEnum = z.enum(['DRAFT', 'VALIDATE', 'VALIDATE_AND_EMAIL']);
export const recurringRunStatusEnum = z.enum(['OK', 'FAILED']);

/**
 * What every generated invoice is built from: a sales invoice body without the
 * fields the schedule owns (type, customer, dates).
 */
export const recurringTemplate = documentCreate.omit({
  type: true,
  contactId: true,
  issueDate: true,
  dueDate: true,
  validUntil: true,
  deliveryDate: true,
});

const scheduleFields = {
  name: z.string().min(1).max(200),
  contactId: uuid,
  template: recurringTemplate,
  frequency: recurringFrequencyEnum,
  interval: z.number().int().min(1).max(60).default(1),
  startDate: isoDate,
  endDate: isoDate.nullish(),
  maxOccurrences: z.number().int().min(1).max(10_000).nullish(),
  /** IANA timezone; defaults to Africa/Casablanca. */
  timezone: z.string().min(1).max(64).optional(),
  mode: recurringModeEnum.default('DRAFT'),
  isActive: z.boolean().default(true),
};

export const recurringCreate = z.object(scheduleFields);

/** Replace-style edit; schedule changes re-anchor the series on the start date. */
export const recurringUpdate = z.object(scheduleFields).partial();

export const recurringInvoice = z.object({
  id: uuid,
  companyId: uuid,
  name: z.string(),
  contactId: uuid,
  contactName: z.string(),
  template: recurringTemplate,
  frequency: recurringFrequencyEnum,
  interval: z.number().int(),
  startDate: isoDate,
  endDate: isoDate.nullable(),
  maxOccurrences: z.number().int().nullable(),
  timezone: z.string(),
  nextRunAt: isoDate.nullable(),
  lastRunAt: isoDateTime.nullable(),
  occurrencesCount: z.number().int(),
  consecutiveFailures: z.number().int(),
  mode: recurringModeEnum,
  isActive: z.boolean(),
  /** True once endDate / maxOccurrences has been reached. */
  isCompleted: z.boolean(),
  createdById: uuid,
  createdByName: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const recurringRun = z.object({
  id: uuid,
  recurringId: uuid,
  documentId: uuid.nullable(),
  documentNumber: z.string().nullable(),
  scheduledFor: isoDate,
  runAt: isoDateTime,
  status: recurringRunStatusEnum,
  error: z.string().nullable(),
});

export const recurringFromDocument = z.object({
  name: z.string().min(1).max(200).optional(),
  frequency: recurringFrequencyEnum.default('MONTHLY'),
  interval: z.number().int().min(1).max(60).default(1),
  startDate: isoDate.optional(),
  mode: recurringModeEnum.default('DRAFT'),
});
