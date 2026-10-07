import { z } from 'zod';
import { contactKindEnum } from './common';

/** Hard limits, shared so the web can pre-check before uploading. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

export const importKind = z.enum(['products', 'contacts']);

export const importDelimiter = z.enum([',', ';', '\t']);

export const importPreviewRequest = z.object({
  csv: z.string().min(1),
  delimiter: importDelimiter.optional(),
  /** Contacts only: kind used when a row has no type column. */
  defaultKind: contactKindEnum.optional(),
});

export const importMode = z.enum(['skip', 'update']);

export const importCommitRequest = importPreviewRequest.extend({
  mode: importMode.default('skip'),
});

export const importDuplicate = z.object({
  /** What matched: sku, barcode, ice, taxId, email, name. */
  by: z.string(),
  existingId: z.string().nullable(),
  label: z.string(),
  /** 'database' for an existing record, 'file' for an earlier row of the same file. */
  source: z.enum(['database', 'file']),
  /** Row number of the earlier row when source is 'file'. */
  row: z.number().int().nullable(),
});

export const importPreviewRow = z.object({
  /** 1-based line number in the file, header included (so row 2 is the first data row). */
  row: z.number().int(),
  values: z.record(z.string()),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  duplicate: importDuplicate.nullable(),
});

export const importHeader = z.object({
  header: z.string(),
  field: z.string().nullable(),
});

export const importPreviewResponse = z.object({
  kind: importKind,
  delimiter: importDelimiter,
  headers: z.array(importHeader),
  missingRequired: z.array(z.string()),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  errorRows: z.number().int(),
  duplicateRows: z.number().int(),
  rows: z.array(importPreviewRow),
});

export const importRowResult = z.object({
  row: z.number().int(),
  status: z.enum(['created', 'updated', 'skipped', 'failed']),
  message: z.string().nullable(),
});

export const importCommitResponse = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  results: z.array(importRowResult),
});

export const importTemplateQuery = z.object({
  lang: z.enum(['fr', 'en']).default('fr'),
});

export const importTemplateResponse = z.object({
  filename: z.string(),
  csv: z.string(),
});

export type ImportPreviewResponse = z.infer<typeof importPreviewResponse>;
export type ImportPreviewRow = z.infer<typeof importPreviewRow>;
export type ImportCommitResponse = z.infer<typeof importCommitResponse>;
