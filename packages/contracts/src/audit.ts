import { z } from 'zod';
import { isoDateTime, uuid } from './common';

export const auditLogQuery = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(100).optional(),
  userId: uuid.optional(),
  /** Exact action name (documents.validate) or a prefix ending in `.` / `*`. */
  action: z.string().max(100).optional(),
  /** Inclusive lower bound, ISO date or datetime. */
  from: z.string().optional(),
  /** Inclusive upper bound; a bare date covers the whole day. */
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditLogQuery = z.infer<typeof auditLogQuery>;

export const auditLogEntry = z.object({
  id: uuid,
  createdAt: isoDateTime,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  companyId: uuid.nullable(),
  userId: uuid.nullable(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** Sanitized before/after/meta payload; shape varies by action. */
  diff: z.record(z.unknown()).nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntry>;

export const auditLogPage = z.object({
  items: z.array(auditLogEntry),
  nextCursor: z.string().nullable(),
});
