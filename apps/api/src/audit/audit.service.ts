import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditLogQuery } from '@mizmar/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { decodeCursor, toPage } from '../common/util/cursor';
import type { RequestContext } from '../tenancy/request-context';
import { sanitize } from './audit.sanitize';

/** The slice of the request context an audit entry needs. */
export type AuditActor = Pick<RequestContext, 'organizationId'> &
  Partial<Pick<RequestContext, 'userId' | 'membershipId' | 'companyId'>>;

export interface AuditRecordInput {
  ctx: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

type ListQuery = Partial<AuditLogQuery> & { limit: number };

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Append an entry. Never throws: auditing must not break the request. */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      const diff: Record<string, unknown> = {};
      if (input.before !== undefined) diff.before = sanitize(input.before);
      if (input.after !== undefined) diff.after = sanitize(input.after);
      const meta = {
        ...(input.ctx.membershipId ? { membershipId: input.ctx.membershipId } : {}),
        ...input.meta,
      };
      if (Object.keys(meta).length > 0) diff.meta = sanitize(meta);

      await this.prisma.auditLog.create({
        data: {
          organizationId: input.ctx.organizationId,
          companyId: input.ctx.companyId ?? null,
          userId: input.ctx.userId ?? null,
          action: input.action.slice(0, 100),
          entityType: input.entityType.slice(0, 60),
          entityId: input.entityId?.slice(0, 100) ?? null,
          diff: Object.keys(diff).length > 0 ? (diff as Prisma.InputJsonValue) : Prisma.DbNull,
          ipAddress: input.ipAddress?.slice(0, 64) ?? null,
          userAgent: input.userAgent?.slice(0, 300) ?? null,
          // Set here, not by the database: millisecond precision keeps keyset
          // cursors exact when they round-trip through a JS Date.
          createdAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record audit entry ${input.action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Login outcome for an unauthenticated request: resolves the org from the email. */
  async recordLogin(input: {
    email: string;
    success: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
    reason?: string;
  }): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: input.email.toLowerCase().trim() },
        select: {
          id: true,
          memberships: {
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { id: true, organizationId: true },
          },
        },
      });
      const membership = user?.memberships[0];
      // An unknown email has no organization to attach the entry to.
      if (!user || !membership) return;
      await this.record({
        ctx: {
          organizationId: membership.organizationId,
          userId: user.id,
          membershipId: membership.id,
        },
        action: input.success ? 'auth.login' : 'auth.login_failed',
        entityType: 'User',
        entityId: user.id,
        meta: { email: input.email, ...(input.reason ? { reason: input.reason } : {}) },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record login event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async list(ctx: RequestContext, query: ListQuery) {
    if (!ctx.ability.can('read', 'AuditLog')) throw AppError.forbidden();

    const and: Prisma.AuditLogWhereInput[] = [
      { organizationId: ctx.organizationId },
      // Org-level events (members, logins) carry no company.
      { OR: [{ companyId: { in: ctx.companyIds } }, { companyId: null }] },
    ];
    if (query.entityType) and.push({ entityType: query.entityType });
    if (query.entityId) and.push({ entityId: query.entityId });
    if (query.userId) and.push({ userId: query.userId });
    if (query.action) {
      if (/[*.]$/.test(query.action)) {
        const prefix = query.action.replace(/[*.]+$/, '');
        and.push({ action: { startsWith: `${prefix}.` } });
      } else {
        and.push({ action: query.action });
      }
    }
    const from = parseBound(query.from, false);
    const to = parseBound(query.to, true);
    if (from) and.push({ createdAt: { gte: from } });
    if (to) and.push({ createdAt: { lte: to } });

    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      const at = new Date(cursor.value);
      if (!Number.isNaN(at.getTime())) {
        and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }] });
      }
    }

    const rows = await this.prisma.auditLog.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { user: { select: { fullName: true, email: true } } },
    });

    const page = toPage(rows, query.limit, (row) => ({
      value: row.createdAt.toISOString(),
      id: row.id,
    }));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        companyId: row.companyId,
        userId: row.userId,
        userName: row.user?.fullName ?? null,
        userEmail: row.user?.email ?? null,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        diff: (row.diff ?? null) as Record<string, unknown> | null,
      })),
    };
  }
}

function parseBound(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value) return null;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(bare ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}
