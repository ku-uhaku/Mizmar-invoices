import { Injectable } from '@nestjs/common';
import { dec, subject } from '@mizmar/core';
import type { reportSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut, qtyOut } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import {
  aggregateVat,
  buildStatementRows,
  groupSales,
  type SalesFact,
  type StatementEntry,
  type VatDocument,
} from './aggregate';
import { periodKey } from './period';

type SalesQuery = z.infer<typeof reportSchemas.salesReportQuery>;
type SalesResponse = z.infer<typeof reportSchemas.salesReportResponse>;
type VatResponse = z.infer<typeof reportSchemas.vatReportResponse>;
type StatementQuery = z.infer<typeof reportSchemas.statementReportQuery>;
type StatementResponse = z.infer<typeof reportSchemas.statementReportResponse>;
type StockResponse = z.infer<typeof reportSchemas.stockValuationResponse>;

const LIVE: { in: Array<'VALIDATED' | 'SENT'> } = { in: ['VALIDATED', 'SENT'] };

interface VatBucketJson {
  rate: string | number;
  base: string | number;
  amount: string | number;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Sales
  // =========================================================================

  async sales(ctx: RequestContext, query: SalesQuery): Promise<SalesResponse> {
    this.assertCan(ctx, 'SALES');
    const { from, to } = range(query);
    const currency = await this.currency(ctx);

    const documents = await this.prisma.document.findMany({
      where: {
        companyId: ctx.companyId,
        lifecycle: LIVE,
        type: { in: ['SALES_INVOICE', 'CREDIT_NOTE'] },
        issueDate: { gte: from, lte: to },
      },
      orderBy: { issueDate: 'asc' },
      select: {
        id: true,
        type: true,
        issueDate: true,
        contactId: true,
        totalExclVat: true,
        totalVat: true,
        totalInclVat: true,
        contact: { select: { displayName: true } },
      },
    });

    const facts: SalesFact[] = [];
    for (const document of documents) {
      const sign = document.type === 'CREDIT_NOTE' ? -1 : 1;

      if (query.groupBy === 'product') continue;

      const key =
        query.groupBy === 'customer'
          ? document.contactId
          : periodKey(document.issueDate, query.period);
      facts.push({
        key,
        label: query.groupBy === 'customer' ? document.contact.displayName : key,
        documentId: document.id,
        sign,
        exclVat: document.totalExclVat.toFixed(),
        vat: document.totalVat.toFixed(),
        inclVat: document.totalInclVat.toFixed(),
      });
    }

    if (query.groupBy === 'product') {
      const lines = await this.prisma.documentLine.findMany({
        where: {
          isNote: false,
          document: {
            companyId: ctx.companyId,
            lifecycle: LIVE,
            type: { in: ['SALES_INVOICE', 'CREDIT_NOTE'] },
            issueDate: { gte: from, lte: to },
          },
        },
        select: {
          documentId: true,
          variantId: true,
          sku: true,
          description: true,
          variantLabel: true,
          quantity: true,
          taxableBase: true,
          vatAmount: true,
          lineTotal: true,
        },
      });
      const signs = new Map(documents.map((d) => [d.id, d.type === 'CREDIT_NOTE' ? -1 : 1] as const));
      for (const line of lines) {
        facts.push({
          key: line.variantId ?? `desc:${line.description}`,
          label: [line.sku, line.description, line.variantLabel].filter(Boolean).join(' · '),
          documentId: line.documentId,
          sign: signs.get(line.documentId) ?? 1,
          exclVat: line.taxableBase.toFixed(),
          vat: line.vatAmount.toFixed(),
          inclVat: line.lineTotal.toFixed(),
          quantity: line.quantity.toFixed(),
        });
      }
    }

    const { rows, totals } = groupSales(facts);
    return {
      currency,
      from: query.from,
      to: query.to,
      groupBy: query.groupBy,
      rows,
      totals,
    };
  }

  // =========================================================================
  // VAT
  // =========================================================================

  async vat(ctx: RequestContext, query: { from: string; to: string }): Promise<VatResponse> {
    this.assertCan(ctx, 'VAT');
    const { from, to } = range(query);
    const currency = await this.currency(ctx);

    const documents = await this.prisma.document.findMany({
      where: {
        companyId: ctx.companyId,
        lifecycle: LIVE,
        type: { in: ['SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_INVOICE'] },
        issueDate: { gte: from, lte: to },
      },
      select: { type: true, vatBreakdown: true },
    });

    const toVat = (type: string): VatDocument[] =>
      documents
        .filter((d) => (type === 'PURCHASE_INVOICE' ? d.type === type : d.type !== 'PURCHASE_INVOICE'))
        .map((d) => ({
          sign: d.type === 'CREDIT_NOTE' ? (-1 as const) : (1 as const),
          buckets: (d.vatBreakdown as VatBucketJson[] | null) ?? [],
        }));

    const sales = aggregateVat(toVat('SALES'));
    const purchases = aggregateVat(toVat('PURCHASE_INVOICE'));

    return {
      currency,
      from: query.from,
      to: query.to,
      sales,
      purchases,
      netVatDue: moneyOut(dec(sales.totalVat).minus(dec(purchases.totalVat))),
    };
  }

  // =========================================================================
  // Statements
  // =========================================================================

  async statement(ctx: RequestContext, query: StatementQuery): Promise<StatementResponse> {
    this.assertCan(ctx, 'STATEMENT');
    const { to } = range(query);
    const currency = await this.currency(ctx);

    const contact = await this.prisma.contact.findFirst({
      where: { id: query.contactId, organizationId: ctx.organizationId },
      select: { id: true, displayName: true },
    });
    if (!contact) throw AppError.notFound('Contact', query.contactId);

    const customer = query.party === 'customer';

    const [documents, payments] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          companyId: ctx.companyId,
          contactId: contact.id,
          lifecycle: LIVE,
          type: { in: customer ? ['SALES_INVOICE', 'CREDIT_NOTE'] : ['PURCHASE_INVOICE'] },
          issueDate: { lte: to },
        },
        select: { type: true, number: true, issueDate: true, totalInclVat: true },
      }),
      this.prisma.payment.findMany({
        where: {
          companyId: ctx.companyId,
          contactId: contact.id,
          direction: customer ? 'INBOUND' : 'OUTBOUND',
          paidAt: { lte: to },
        },
        select: { reference: true, method: true, amount: true, paidAt: true },
      }),
    ]);

    const entries: StatementEntry[] = [];
    for (const document of documents) {
      const amount = moneyOut(dec(document.totalInclVat.toFixed()).abs());
      const isCredit = document.type === 'CREDIT_NOTE';
      entries.push({
        date: document.issueDate.toISOString().slice(0, 10),
        kind: 'DOCUMENT',
        reference: document.number ?? '',
        label: document.type,
        debit: isCredit ? '0.00' : amount,
        credit: isCredit ? amount : '0.00',
      });
    }
    for (const payment of payments) {
      entries.push({
        date: payment.paidAt.toISOString().slice(0, 10),
        kind: 'PAYMENT',
        reference: payment.reference ?? '',
        label: `PAYMENT ${payment.method}`,
        debit: '0.00',
        credit: moneyOut(dec(payment.amount.toFixed()).abs()),
      });
    }
    // Stable: documents before payments on the same day.
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

    return {
      currency,
      contactId: contact.id,
      contactName: contact.displayName,
      party: query.party,
      from: query.from,
      to: query.to,
      ...buildStatementRows(entries, query.from),
    };
  }

  // =========================================================================
  // Stock valuation
  // =========================================================================

  async stockValuation(
    ctx: RequestContext,
    query: { warehouseId?: string },
  ): Promise<StockResponse> {
    this.assertCan(ctx, 'STOCK');
    // Valuation is cost data; whoever may not see cost may not see this.
    if (!ctx.ability.can('read', 'ProductVariant', 'averageCost')) {
      throw AppError.forbidden('Your role may not see inventory cost');
    }
    const currency = await this.currency(ctx);

    const levels = await this.prisma.stockLevel.findMany({
      where: {
        warehouse: { organizationId: ctx.organizationId },
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        onHand: { not: 0 },
      },
      select: {
        onHand: true,
        averageCost: true,
        warehouse: { select: { code: true, name: true } },
        variant: {
          select: {
            id: true,
            sku: true,
            variantLabel: true,
            product: { select: { name: true } },
          },
        },
      },
    });

    let total = dec(0);
    const perWarehouse = new Map<string, { name: string; value: ReturnType<typeof dec> }>();
    const rows = levels.map((level) => {
      const value = dec(level.onHand.toFixed()).times(dec(level.averageCost.toFixed()));
      total = total.plus(value);
      const entry = perWarehouse.get(level.warehouse.code) ?? {
        name: level.warehouse.name,
        value: dec(0),
      };
      entry.value = entry.value.plus(value);
      perWarehouse.set(level.warehouse.code, entry);
      return {
        warehouseCode: level.warehouse.code,
        warehouseName: level.warehouse.name,
        variantId: level.variant.id,
        sku: level.variant.sku,
        productName: level.variant.product.name,
        variantLabel: level.variant.variantLabel,
        onHand: qtyOut(level.onHand),
        averageCost: qtyOut(level.averageCost),
        value: moneyOut(value),
      };
    });

    rows.sort(
      (a, b) =>
        a.warehouseCode.localeCompare(b.warehouseCode) ||
        a.productName.localeCompare(b.productName) ||
        a.sku.localeCompare(b.sku),
    );

    return {
      currency,
      rows,
      warehouseTotals: [...perWarehouse.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, entry]) => ({
          warehouseCode: code,
          warehouseName: entry.name,
          value: moneyOut(entry.value),
        })),
      totalValue: moneyOut(total),
    };
  }

  // =========================================================================

  private assertCan(ctx: RequestContext, kind: 'SALES' | 'VAT' | 'STATEMENT' | 'STOCK') {
    if (!ctx.ability.can('read', subject('Report', { kind }))) {
      throw AppError.forbidden('Your role may not view reports');
    }
  }

  private async currency(ctx: RequestContext): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { defaultCurrency: true },
    });
    return company.defaultCurrency;
  }
}

function range(query: { from: string; to: string }): { from: Date; to: Date } {
  const from = new Date(`${query.from}T00:00:00.000Z`);
  const to = new Date(`${query.to}T00:00:00.000Z`);
  if (from > to) throw AppError.badRequest('INVALID_RANGE', '"from" must not be after "to"');
  return { from, to };
}
