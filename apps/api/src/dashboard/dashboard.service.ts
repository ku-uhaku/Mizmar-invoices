import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec } from '@mizmar/core';
import type { dashboardSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { moneyOut, qtyOut } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';

type DashboardResponse = z.infer<typeof dashboardSchemas.dashboardResponse>;

const DAY_MS = 86_400_000;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    ctx: RequestContext,
    query: { from?: string; to?: string },
  ): Promise<DashboardResponse> {
    const now = new Date();
    const to = query.to ? new Date(query.to) : endOfDay(now);
    // Defaults to the current month, which is the window a daily standup uses.
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    const todayStart = startOfDay(now);
    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - (to.getTime() - from.getTime()));
    // Five full months before the current one, plus the current month so far.
    const monthsStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 5, 1));

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { defaultCurrency: true },
    });

    const maySeeCost = ctx.ability.can('read', 'ProductVariant', 'averageCost');

    const liveSales: Prisma.DocumentWhereInput = {
      companyId: ctx.companyId,
      lifecycle: { in: ['VALIDATED', 'SENT'] },
      type: { in: ['SALES_INVOICE'] },
    };

    const [
      salesToday,
      salesPeriod,
      salesPeriodCount,
      creditPeriod,
      collectedPeriod,
      receivables,
      drafts,
      ordersAwaitingDelivery,
      deliveriesAwaitingInvoice,
      trendRows,
      topClientRows,
      lowStockRows,
      recentDocuments,
      recentPayments,
      recentMovements,
      stockValueRows,
      previousSales,
      previousCredit,
      collectedRows,
      monthlyRows,
      topProductRows,
    ] = await Promise.all([
      this.prisma.document.aggregate({
        where: { ...liveSales, issueDate: { gte: todayStart, lte: to } },
        _sum: { totalExclVat: true },
      }),
      this.prisma.document.aggregate({
        where: { ...liveSales, issueDate: { gte: from, lte: to } },
        _sum: { totalExclVat: true },
      }),
      this.prisma.document.count({
        where: { ...liveSales, issueDate: { gte: from, lte: to } },
      }),
      this.prisma.document.aggregate({
        where: {
          companyId: ctx.companyId,
          lifecycle: { in: ['VALIDATED', 'SENT'] },
          type: 'CREDIT_NOTE',
          issueDate: { gte: from, lte: to },
        },
        _sum: { totalExclVat: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          companyId: ctx.companyId,
          direction: 'INBOUND',
          status: { notIn: ['BOUNCED', 'CANCELLED'] },
          paidAt: { gte: from, lte: to },
        },
        _sum: { amount: true },
      }),
      this.prisma.document.findMany({
        where: {
          companyId: ctx.companyId,
          lifecycle: { in: ['VALIDATED', 'SENT'] },
          type: { in: ['SALES_INVOICE', 'CREDIT_NOTE'] },
          settlement: { in: ['UNPAID', 'PARTIAL'] },
        },
        select: { type: true, dueDate: true, totalInclVat: true, paidAmount: true },
      }),
      this.prisma.document.count({
        where: { companyId: ctx.companyId, lifecycle: 'DRAFT' },
      }),
      this.prisma.document.count({
        where: {
          companyId: ctx.companyId,
          type: 'SALES_ORDER',
          lifecycle: { in: ['VALIDATED', 'SENT'] },
          fulfilment: { in: ['PENDING', 'PARTIAL'] },
        },
      }),
      this.prisma.document.count({
        where: {
          companyId: ctx.companyId,
          type: 'DELIVERY_NOTE',
          lifecycle: { in: ['VALIDATED', 'SENT'] },
          fulfilment: { in: ['PENDING', 'PARTIAL'] },
        },
      }),
      this.prisma.document.groupBy({
        by: ['issueDate'],
        where: {
          ...liveSales,
          issueDate: { gte: new Date(to.getTime() - 29 * DAY_MS), lte: to },
        },
        _sum: { totalExclVat: true },
      }),
      this.prisma.document.groupBy({
        by: ['contactId'],
        where: { ...liveSales, issueDate: { gte: from, lte: to } },
        _sum: { totalExclVat: true },
        orderBy: { _sum: { totalExclVat: 'desc' } },
        take: 5,
      }),
      // "Below threshold" compares two columns, which Prisma cannot filter on,
      // so a bounded window is fetched and narrowed in memory.
      this.prisma.stockLevel.findMany({
        where: {
          warehouse: { organizationId: ctx.organizationId },
          variant: { isActive: true, product: { isActive: true, isService: false } },
        },
        take: 500,
        orderBy: { onHand: 'asc' },
        select: {
          onHand: true,
          reserved: true,
          variant: {
            select: {
              id: true,
              sku: true,
              variantLabel: true,
              minStockThreshold: true,
              product: { select: { name: true } },
            },
          },
          warehouse: { select: { code: true } },
        },
      }),
      this.prisma.document.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          type: true,
          number: true,
          lifecycle: true,
          totalInclVat: true,
          updatedAt: true,
          contact: { select: { displayName: true } },
          createdBy: { select: { fullName: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          amount: true,
          method: true,
          createdAt: true,
          contact: { select: { displayName: true } },
          createdBy: { select: { fullName: true } },
        },
      }),
      this.prisma.stockMovement.findMany({
        where: { warehouse: { organizationId: ctx.organizationId }, documentId: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          type: true,
          quantity: true,
          createdAt: true,
          variant: { select: { sku: true } },
          warehouse: { select: { code: true } },
          user: { select: { fullName: true } },
        },
      }),
      maySeeCost
        ? this.prisma.stockLevel.findMany({
            where: { warehouse: { organizationId: ctx.organizationId } },
            select: { onHand: true, averageCost: true },
          })
        : Promise.resolve([]),
      this.prisma.document.aggregate({
        where: { ...liveSales, issueDate: { gte: previousFrom, lte: previousTo } },
        _sum: { totalExclVat: true },
      }),
      this.prisma.document.aggregate({
        where: {
          companyId: ctx.companyId,
          lifecycle: { in: ['VALIDATED', 'SENT'] },
          type: 'CREDIT_NOTE',
          issueDate: { gte: previousFrom, lte: previousTo },
        },
        _sum: { totalExclVat: true },
      }),
      this.prisma.payment.findMany({
        where: {
          companyId: ctx.companyId,
          direction: 'INBOUND',
          status: { notIn: ['BOUNCED', 'CANCELLED'] },
          paidAt: { gte: new Date(to.getTime() - 29 * DAY_MS), lte: to },
        },
        select: { paidAt: true, amount: true },
      }),
      this.prisma.document.groupBy({
        by: ['issueDate'],
        where: { ...liveSales, issueDate: { gte: monthsStart, lte: to } },
        _sum: { totalExclVat: true },
      }),
      this.prisma.documentLine.groupBy({
        by: ['sku', 'description'],
        where: {
          isNote: false,
          document: { ...liveSales, issueDate: { gte: from, lte: to } },
        },
        _sum: { quantity: true, taxableBase: true },
        orderBy: { _sum: { taxableBase: 'desc' } },
        take: 5,
      }),
    ]);

    // ---- Receivables, with overdue computed against the clock ------------
    let outstanding = dec(0);
    let overdue = dec(0);
    let overdueCount = 0;
    const aging = {
      CURRENT: { amount: dec(0), count: 0 },
      D1_30: { amount: dec(0), count: 0 },
      D31_60: { amount: dec(0), count: 0 },
      D61_90: { amount: dec(0), count: 0 },
      D90_PLUS: { amount: dec(0), count: 0 },
    };

    for (const row of receivables) {
      const remaining = dec(row.totalInclVat.toFixed())
        .abs()
        .minus(dec(row.paidAmount.toFixed()).abs());
      if (remaining.lte(0)) continue;

      const signed = row.type === 'CREDIT_NOTE' ? remaining.negated() : remaining;
      outstanding = outstanding.plus(signed);

      if (row.type !== 'CREDIT_NOTE' && row.dueDate && row.dueDate < now) {
        overdue = overdue.plus(remaining);
        overdueCount += 1;
      }

      if (row.type !== 'CREDIT_NOTE') {
        const daysLate = row.dueDate ? Math.floor((now.getTime() - row.dueDate.getTime()) / DAY_MS) : 0;
        const bucket =
          daysLate <= 0 ? 'CURRENT' : daysLate <= 30 ? 'D1_30' : daysLate <= 60 ? 'D31_60' : daysLate <= 90 ? 'D61_90' : 'D90_PLUS';
        aging[bucket].amount = aging[bucket].amount.plus(remaining);
        aging[bucket].count += 1;
      }
    }

    // ---- Low stock -------------------------------------------------------
    const lowStock = lowStockRows
      .filter((row) =>
        dec(row.onHand.toFixed())
          .minus(dec(row.reserved.toFixed()))
          .lte(dec(row.variant.minStockThreshold.toFixed())),
      )
      .slice(0, 20);

    const outOfStockCount = lowStockRows.filter((row) =>
      dec(row.onHand.toFixed()).lte(0),
    ).length;

    // ---- Trend: one point per day, gaps filled with zero -----------------
    const trendByDay = new Map(
      trendRows.map((row) => [
        row.issueDate.toISOString().slice(0, 10),
        dec((row._sum?.totalExclVat ?? 0).toString()),
      ]),
    );
    const salesTrend: Array<{ date: string; total: string }> = [];
    for (let offset = 29; offset >= 0; offset -= 1) {
      const day = new Date(to.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
      salesTrend.push({ date: day, total: moneyOut(trendByDay.get(day) ?? 0) });
    }

    const collectedByDay = new Map<string, ReturnType<typeof dec>>();
    for (const row of collectedRows) {
      const day = row.paidAt.toISOString().slice(0, 10);
      collectedByDay.set(day, (collectedByDay.get(day) ?? dec(0)).plus(dec(row.amount.toFixed())));
    }
    const collectedTrend = salesTrend.map((point) => ({
      date: point.date,
      total: moneyOut(collectedByDay.get(point.date) ?? 0),
    }));

    const monthTotals = new Map<string, ReturnType<typeof dec>>();
    for (const row of monthlyRows) {
      const month = row.issueDate.toISOString().slice(0, 7);
      monthTotals.set(
        month,
        (monthTotals.get(month) ?? dec(0)).plus(dec((row._sum?.totalExclVat ?? 0).toString())),
      );
    }
    const monthlyTrend: Array<{ month: string; total: string }> = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const month = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - offset, 1))
        .toISOString()
        .slice(0, 7);
      monthlyTrend.push({ month, total: moneyOut(monthTotals.get(month) ?? 0) });
    }

    // ---- Top clients -----------------------------------------------------
    const topContacts = await this.prisma.contact.findMany({
      where: { id: { in: topClientRows.map((row) => row.contactId) } },
      select: { id: true, displayName: true },
    });
    const contactNames = new Map(topContacts.map((contact) => [contact.id, contact.displayName]));

    // ---- Activity feed: documents, payments and manual stock moves -------
    const recentActivity = [
      ...recentDocuments.map((document) => ({
        at: document.updatedAt,
        kind: 'DOCUMENT' as const,
        documentId: document.id,
        documentType: document.type,
        label: `${document.number ?? 'Draft'} — ${document.contact.displayName}`,
        amount: moneyOut(document.totalInclVat),
        userName: document.createdBy?.fullName ?? null,
      })),
      ...recentPayments.map((payment) => ({
        at: payment.createdAt,
        kind: 'PAYMENT' as const,
        documentId: null,
        documentType: null,
        label: `Payment ${payment.method} — ${payment.contact.displayName}`,
        amount: moneyOut(payment.amount),
        userName: payment.createdBy?.fullName ?? null,
      })),
      ...recentMovements.map((movement) => ({
        at: movement.createdAt,
        kind: 'STOCK' as const,
        documentId: null,
        documentType: null,
        label: `${movement.type} ${movement.variant.sku} @ ${movement.warehouse.code} (${qtyOut(movement.quantity)})`,
        amount: null,
        userName: movement.user?.fullName ?? null,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 12)
      .map((entry) => ({ ...entry, at: entry.at.toISOString() }));

    const totalStockValue = stockValueRows.reduce(
      (acc, row) => acc.plus(dec(row.onHand.toFixed()).times(dec(row.averageCost.toFixed()))),
      dec(0),
    );

    return {
      currency: company.defaultCurrency,
      sales: {
        today: moneyOut(salesToday._sum?.totalExclVat ?? 0),
        period: moneyOut(salesPeriod._sum?.totalExclVat ?? 0),
        // Net of credit notes: gross invoicing alone overstates the month.
        invoicedPeriod: moneyOut(
          dec((salesPeriod._sum?.totalExclVat ?? 0).toString()).minus(
            dec((creditPeriod._sum?.totalExclVat ?? 0).toString()).abs(),
          ),
        ),
        previousInvoiced: moneyOut(
          dec((previousSales._sum?.totalExclVat ?? 0).toString()).minus(
            dec((previousCredit._sum?.totalExclVat ?? 0).toString()).abs(),
          ),
        ),
        collectedPeriod: moneyOut(collectedPeriod._sum?.amount ?? 0),
        documentCount: salesPeriodCount,
      },
      receivables: {
        outstanding: moneyOut(outstanding),
        overdue: moneyOut(overdue),
        overdueDocumentCount: overdueCount,
      },
      stock: {
        lowStockVariantCount: lowStock.length,
        outOfStockVariantCount: outOfStockCount,
        ...(maySeeCost ? { totalStockValue: moneyOut(totalStockValue) } : {}),
      },
      pending: {
        draftDocumentCount: drafts,
        ordersAwaitingDelivery,
        deliveriesAwaitingInvoice,
      },
      salesTrend,
      collectedTrend,
      monthlyTrend,
      receivablesAging: (Object.keys(aging) as Array<keyof typeof aging>).map((bucket) => ({
        bucket,
        amount: moneyOut(aging[bucket].amount),
        count: aging[bucket].count,
      })),
      topProducts: topProductRows.map((row) => ({
        sku: row.sku,
        description: row.description,
        quantity: qtyOut(row._sum?.quantity ?? 0),
        total: moneyOut(row._sum?.taxableBase ?? 0),
      })),
      topClients: topClientRows.map((row) => ({
        contactId: row.contactId,
        contactName: contactNames.get(row.contactId) ?? '',
        total: moneyOut(row._sum?.totalExclVat ?? 0),
      })),
      lowStockAlerts: lowStock.map((row) => ({
        variantId: row.variant.id,
        sku: row.variant.sku,
        productName: row.variant.product.name,
        variantLabel: row.variant.variantLabel,
        warehouseCode: row.warehouse.code,
        onHand: qtyOut(row.onHand),
        minStockThreshold: qtyOut(row.variant.minStockThreshold),
      })),
      recentActivity,
    };
  }
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}
