import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec } from '@mizmar/core';
import type { payablesSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut } from '../common/util/decimal';
import { bucketFor, buildAgeing } from '../receivables/ageing';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';

type Overview = z.infer<typeof payablesSchemas.payablesOverview>;
type Item = Overview['items'][number];

const DAY = 24 * 60 * 60 * 1000;
/** Stand-in grouping key for expenses that have no supplier. */
const NO_SUPPLIER = '00000000-0000-0000-0000-000000000000';

/** What the business owes: unpaid purchase invoices and unpaid expenses. */
@Injectable()
export class PayablesService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(ctx: RequestContext, query: { contactId?: string }): Promise<Overview> {
    if (!ctx.ability.can('read', 'Payment')) throw AppError.forbidden('Your role may not see payables');

    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    const [company, documents, expenses] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: ctx.companyId },
        select: { defaultCurrency: true },
      }),
      this.prisma.document.findMany({
        where: {
          companyId: ctx.companyId,
          type: 'PURCHASE_INVOICE',
          lifecycle: { in: ['VALIDATED', 'SENT'] },
          settlement: { in: ['UNPAID', 'PARTIAL'] },
          ...(query.contactId ? { contactId: query.contactId } : {}),
        },
        select: {
          id: true,
          number: true,
          reference: true,
          contactId: true,
          issueDate: true,
          dueDate: true,
          currency: true,
          totalInclVat: true,
          paidAmount: true,
          contact: { select: { displayName: true } },
        },
        take: 2000,
      }),
      this.prisma.expense.findMany({
        where: {
          companyId: ctx.companyId,
          status: { in: ['UNPAID', 'PARTIAL'] },
          ...(query.contactId ? { supplierId: query.contactId } : {}),
        },
        select: {
          id: true,
          reference: true,
          description: true,
          supplierId: true,
          issueDate: true,
          dueDate: true,
          currency: true,
          totalInclVat: true,
          paidAmount: true,
          supplier: { select: { displayName: true } },
        },
        take: 2000,
      }),
    ]);

    const items: Item[] = [];
    const push = (input: {
      source: Item['source'];
      id: string;
      contactId: string | null;
      contactName: string;
      reference: string | null;
      issueDate: Date;
      dueDate: Date | null;
      currency: string;
      total: Prisma.Decimal;
      paid: Prisma.Decimal;
    }) => {
      const outstanding = dec(input.total.toFixed()).abs().minus(dec(input.paid.toFixed()).abs());
      if (outstanding.lte(0)) return;
      items.push({
        source: input.source,
        id: input.id,
        contactId: input.contactId,
        contactName: input.contactName,
        reference: input.reference,
        issueDate: input.issueDate.toISOString().slice(0, 10),
        dueDate: input.dueDate?.toISOString().slice(0, 10) ?? null,
        currency: input.currency,
        total: moneyOut(input.total),
        paid: moneyOut(input.paid),
        outstanding: moneyOut(outstanding),
        daysOverdue: input.dueDate ? Math.round((today - input.dueDate.getTime()) / DAY) : null,
        bucket: bucketFor(input.dueDate, now),
      });
    };

    for (const row of documents) {
      push({
        source: 'DOCUMENT',
        id: row.id,
        contactId: row.contactId,
        contactName: row.contact.displayName,
        reference: row.number ?? row.reference ?? null,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        currency: row.currency,
        total: row.totalInclVat,
        paid: row.paidAmount,
      });
    }
    for (const row of expenses) {
      push({
        source: 'EXPENSE',
        id: row.id,
        contactId: row.supplierId,
        contactName: row.supplier?.displayName ?? '—',
        reference: row.reference ?? row.description ?? null,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        currency: row.currency,
        total: row.totalInclVat,
        paid: row.paidAmount,
      });
    }

    // Soonest due first, undated last: the order bills get paid in.
    items.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));

    const { rows, totals } = buildAgeing(
      items.map((item) => ({
        contactId: item.contactId ?? NO_SUPPLIER,
        contactName: item.contactName,
        dueDate: item.dueDate ? new Date(item.dueDate) : null,
        outstanding: item.outstanding,
      })),
      now,
    );

    const overdue = items.filter((item) => (item.daysOverdue ?? 0) > 0);
    const soon = items.filter((item) => item.daysOverdue !== null && item.daysOverdue <= 0 && item.daysOverdue >= -7);
    const sum = (list: Item[]) => list.reduce((acc, item) => acc.plus(dec(item.outstanding)), dec(0));

    return {
      currency: company.defaultCurrency,
      asOf: now.toISOString().slice(0, 10),
      totals,
      overdueTotal: moneyOut(sum(overdue)),
      dueSoonTotal: moneyOut(sum(soon)),
      rows: rows.map((row) => ({
        contactId: row.contactId === NO_SUPPLIER ? null : row.contactId,
        contactName: row.contactId === NO_SUPPLIER ? '—' : row.contactName,
        billCount: row.invoiceCount,
        buckets: row.buckets,
      })),
      items,
    };
  }
}
