import { Injectable } from '@nestjs/common';
import { dec, localDate, subject, type Decimal } from '@mizmar/core';
import type { reportSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut, qtyOut } from '../common/util/decimal';
import { LeaveService } from '../hr/leave.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { groupSales, type SalesFact } from './aggregate';
import { periodKey, type Period } from './period';
import {
  ageingBucket,
  col,
  daysBetween,
  pct,
  totalsRow,
  type AgeingBucket,
  type TableColumn,
  type TableRow,
} from './table';

export type TableQuery = z.infer<typeof reportSchemas.tableReportQuery>;
export type TableReport = z.infer<typeof reportSchemas.tableReportResponse>;

const LIVE: { in: Array<'VALIDATED' | 'SENT'> } = { in: ['VALIDATED', 'SENT'] };
const OPEN_EXPENSE = ['UNPAID', 'PARTIAL'] as const;
const COUNTED_EXPENSE = ['UNPAID', 'PARTIAL', 'PAID'] as const;

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDay = (value: Date) => value.toISOString().slice(0, 10);

export const PAYMENT_METHODS = ['CASH', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'BILL_OF_EXCHANGE', 'OTHER'] as const;
const METHOD_LABEL: Record<string, string> = {
  CASH: 'Espèces',
  CARD: 'Carte bancaire',
  CHEQUE: 'Chèque',
  BANK_TRANSFER: 'Virement',
  BILL_OF_EXCHANGE: 'Effet de commerce',
  OTHER: 'Autre',
};
const MOVEMENT_LABEL: Record<string, string> = {
  OPENING_BALANCE: 'Stock initial',
  SALE: 'Vente',
  SALE_RETURN: 'Retour client',
  PURCHASE: 'Achat',
  PURCHASE_RETURN: 'Retour fournisseur',
  ADJUSTMENT: 'Ajustement',
  COUNT_CORRECTION: 'Correction d’inventaire',
  TRANSFER_OUT: 'Transfert sortant',
  TRANSFER_IN: 'Transfert entrant',
  CANCELLATION: 'Annulation',
};
const COUNT_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Ouvert',
  COUNTING: 'En comptage',
  REVIEW: 'En revue',
  POSTED: 'Validé',
  ABANDONED: 'Abandonné',
};
const TRANSFER_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Brouillon',
  IN_TRANSIT: 'En transit',
  RECEIVED: 'Reçu',
  CANCELLED: 'Annulé',
};

/**
 * Analytic reports that share one response shape (see `tableReportResponse`).
 * Every method is company- (or organisation-) scoped and read-only.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leave: LeaveService,
  ) {}

  async run(ctx: RequestContext, name: z.infer<typeof reportSchemas.tableReportName>, q: TableQuery) {
    const today = localDate(new Date());
    const from = q.from ?? `${today.slice(0, 4)}-01-01`;
    const to = q.to ?? today;
    if (from > to) throw AppError.badRequest('INVALID_RANGE', '"from" must not be after "to"');
    const period: Period = q.period ?? 'month';
    const currency = await this.currency(ctx);
    const done = (
      columns: TableColumn[],
      rows: TableRow[],
      totals: TableRow | null = null,
      asOf = false,
    ): TableReport => ({
      currency,
      from: asOf ? null : from,
      to: asOf ? today : to,
      columns,
      rows,
      totals,
    });
    const env = { ctx, q, from, to, period, today, done };

    switch (name) {
      case 'profit-loss':
        this.assertCan(ctx, 'PROFIT_LOSS');
        return this.profitLoss(env);
      case 'cash-flow':
        this.assertCan(ctx, 'CASH_FLOW');
        return this.cashFlow(env);
      case 'payments-by-method':
        this.assertCan(ctx, 'CASH_FLOW');
        return this.paymentsByMethod(env);
      case 'payables-ageing':
        this.assertCan(ctx, 'PAYABLES');
        return this.payablesAgeing(env);
      case 'margin':
        this.assertCan(ctx, 'MARGIN');
        return this.margin(env);
      case 'purchases':
        this.assertCan(ctx, 'PURCHASES');
        return this.purchases(env);
      case 'stock-movements':
        this.assertCan(ctx, 'STOCK');
        return this.stockMovements(env);
      case 'low-stock':
        this.assertCan(ctx, 'STOCK');
        return this.lowStock(env);
      case 'slow-movers':
        this.assertCan(ctx, 'STOCK');
        return this.slowMovers(env);
      case 'stock-counts':
        this.assertCan(ctx, 'STOCK');
        return this.stockCounts(env);
      case 'stock-transfers':
        this.assertCan(ctx, 'STOCK');
        return this.stockTransfers(env);
      case 'cash-up':
        this.assertCan(ctx, 'CASH_FLOW');
        return this.cashUp(env);
      case 'user-activity':
        if (!ctx.ability.can('read', 'AuditLog')) {
          throw AppError.forbidden('Your role may not view the activity journal');
        }
        return this.userActivity(env);
      case 'recurring-runs':
        this.assertCan(ctx, 'SALES');
        return this.recurringRuns(env);
      case 'expenses-by-category':
        this.assertCan(ctx, 'EXPENSES');
        return this.expensesByCategory(env);
      case 'utility-trend':
        this.assertCan(ctx, 'EXPENSES');
        return this.utilityTrend(env);
      case 'upcoming-bills':
        this.assertCan(ctx, 'EXPENSES');
        return this.upcomingBills(env);
      case 'headcount':
        this.assertAbility(ctx, 'Employee');
        return this.headcount(env);
      case 'leave-balances':
        this.assertAbility(ctx, 'Leave');
        return this.leaveBalances(env);
      case 'attendance-summary':
        this.assertAbility(ctx, 'Attendance');
        return this.attendanceSummary(env);
      case 'payroll-register':
        this.assertAbility(ctx, 'Payroll');
        return this.payrollRegister(env);
      case 'cnss-declaration':
        this.assertAbility(ctx, 'Payroll');
        return this.cnssDeclaration(env);
      case 'payroll-by-department':
        this.assertAbility(ctx, 'Payroll');
        return this.payrollByDepartment(env);
      case 'ir-annual':
        this.assertAbility(ctx, 'Payroll');
        return this.irAnnual(env);
      case 'cash-sessions':
        this.assertAbility(ctx, 'Cash');
        return this.cashSessions(env);
      case 'cash-movements':
        this.assertAbility(ctx, 'Cash');
        return this.cashMovements(env);
    }
  }

  // =========================================================================
  // Finance
  // =========================================================================

  private async profitLoss({ ctx, from, to, period, done }: Env): Promise<TableReport> {
    const gte = asDate(from);
    const lte = asDate(to);
    const sales = { companyId: ctx.companyId, lifecycle: LIVE, type: { in: ['SALES_INVOICE', 'CREDIT_NOTE'] as Array<'SALES_INVOICE' | 'CREDIT_NOTE'> }, issueDate: { gte, lte } };

    const [documents, lines, expenses] = await Promise.all([
      this.prisma.document.findMany({
        where: sales,
        select: { issueDate: true, type: true, totalExclVat: true },
      }),
      this.prisma.documentLine.findMany({
        where: { isNote: false, document: sales },
        select: { quantity: true, unitCost: true, document: { select: { issueDate: true, type: true } } },
      }),
      this.prisma.expense.findMany({
        where: { companyId: ctx.companyId, status: { in: [...COUNTED_EXPENSE] }, issueDate: { gte, lte } },
        select: { issueDate: true, amountExclVat: true },
      }),
    ]);

    const buckets = new Map<string, { revenue: Decimal; cogs: Decimal; expenses: Decimal }>();
    const bucket = (date: Date) => {
      const key = periodKey(date, period);
      let entry = buckets.get(key);
      if (!entry) buckets.set(key, (entry = { revenue: dec(0), cogs: dec(0), expenses: dec(0) }));
      return entry;
    };
    for (const document of documents) {
      const sign = document.type === 'CREDIT_NOTE' ? -1 : 1;
      const entry = bucket(document.issueDate);
      entry.revenue = entry.revenue.plus(dec(document.totalExclVat.toFixed()).abs().times(sign));
    }
    for (const line of lines) {
      if (line.unitCost === null) continue;
      const sign = line.document.type === 'CREDIT_NOTE' ? -1 : 1;
      const entry = bucket(line.document.issueDate);
      entry.cogs = entry.cogs.plus(dec(line.quantity.toFixed()).abs().times(dec(line.unitCost.toFixed())).times(sign));
    }
    for (const expense of expenses) {
      const entry = bucket(expense.issueDate);
      entry.expenses = entry.expenses.plus(dec(expense.amountExclVat.toFixed()));
    }

    const columns = [
      col('period', 'Période'),
      col('revenue', 'Chiffre d’affaires HT', 'money'),
      col('cogs', 'Coût des ventes', 'money'),
      col('grossMargin', 'Marge brute', 'money'),
      col('grossMarginPct', 'Marge brute %', 'percent'),
      col('expenses', 'Charges et dépenses', 'money'),
      col('netResult', 'Résultat', 'money'),
    ];
    const rows: TableRow[] = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, e]) => {
        const gross = e.revenue.minus(e.cogs);
        return {
          period: key,
          revenue: moneyOut(e.revenue),
          cogs: moneyOut(e.cogs),
          grossMargin: moneyOut(gross),
          grossMarginPct: pct(gross, e.revenue),
          expenses: moneyOut(e.expenses),
          netResult: moneyOut(gross.minus(e.expenses)),
        };
      });
    const totals = totalsRow(columns, rows, ['revenue', 'cogs', 'grossMargin', 'expenses', 'netResult'], {
      key: 'period',
      text: 'Total',
    });
    totals.grossMarginPct = pct(totals.grossMargin as string, totals.revenue as string);
    return done(columns, rows, totals);
  }

  private async cashFlow({ ctx, from, to, period, done }: Env): Promise<TableReport> {
    const gte = asDate(from);
    const lte = asDate(to);
    const [payments, expensePayments] = await Promise.all([
      this.prisma.payment.findMany({
        where: { companyId: ctx.companyId, paidAt: { gte, lte } },
        select: { paidAt: true, direction: true, amount: true },
      }),
      this.prisma.expensePayment.findMany({
        where: { expense: { companyId: ctx.companyId }, paidAt: { gte, lte } },
        select: { paidAt: true, amount: true },
      }),
    ]);

    const buckets = new Map<string, { inflow: Decimal; suppliers: Decimal; expenses: Decimal }>();
    const bucket = (date: Date) => {
      const key = periodKey(date, period);
      let entry = buckets.get(key);
      if (!entry) buckets.set(key, (entry = { inflow: dec(0), suppliers: dec(0), expenses: dec(0) }));
      return entry;
    };
    for (const payment of payments) {
      const entry = bucket(payment.paidAt);
      const amount = dec(payment.amount.toFixed());
      if (payment.direction === 'INBOUND') entry.inflow = entry.inflow.plus(amount);
      else entry.suppliers = entry.suppliers.plus(amount);
    }
    for (const payment of expensePayments) {
      const entry = bucket(payment.paidAt);
      entry.expenses = entry.expenses.plus(dec(payment.amount.toFixed()));
    }

    const columns = [
      col('period', 'Période'),
      col('inflow', 'Encaissements clients', 'money'),
      col('suppliers', 'Paiements fournisseurs', 'money'),
      col('expenses', 'Paiements de dépenses', 'money'),
      col('net', 'Flux net', 'money'),
      col('cumulative', 'Cumul', 'money'),
    ];
    let running = dec(0);
    const rows: TableRow[] = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, e]) => {
        const net = e.inflow.minus(e.suppliers).minus(e.expenses);
        running = running.plus(net);
        return {
          period: key,
          inflow: moneyOut(e.inflow),
          suppliers: moneyOut(e.suppliers),
          expenses: moneyOut(e.expenses),
          net: moneyOut(net),
          cumulative: moneyOut(running),
        };
      });
    const totals = totalsRow(columns, rows, ['inflow', 'suppliers', 'expenses', 'net'], {
      key: 'period',
      text: 'Total',
    });
    return done(columns, rows, totals);
  }

  private async paymentsByMethod({ ctx, from, to, done }: Env): Promise<TableReport> {
    const gte = asDate(from);
    const lte = asDate(to);
    const [payments, expensePayments] = await Promise.all([
      this.prisma.payment.findMany({
        where: { companyId: ctx.companyId, paidAt: { gte, lte } },
        select: { method: true, direction: true, amount: true },
      }),
      this.prisma.expensePayment.findMany({
        where: { expense: { companyId: ctx.companyId }, paidAt: { gte, lte } },
        select: { method: true, amount: true },
      }),
    ]);
    const rowsByMethod = new Map<string, { inbound: Decimal; outbound: Decimal; expenses: Decimal; count: number }>();
    const entryOf = (method: string) => {
      let entry = rowsByMethod.get(method);
      if (!entry) rowsByMethod.set(method, (entry = { inbound: dec(0), outbound: dec(0), expenses: dec(0), count: 0 }));
      return entry;
    };
    for (const payment of payments) {
      const entry = entryOf(payment.method);
      entry.count++;
      const amount = dec(payment.amount.toFixed());
      if (payment.direction === 'INBOUND') entry.inbound = entry.inbound.plus(amount);
      else entry.outbound = entry.outbound.plus(amount);
    }
    for (const payment of expensePayments) {
      const entry = entryOf(payment.method);
      entry.count++;
      entry.expenses = entry.expenses.plus(dec(payment.amount.toFixed()));
    }

    const columns = [
      col('method', 'Moyen de paiement', 'label'),
      col('count', 'Opérations', 'int'),
      col('inbound', 'Encaissé', 'money'),
      col('outbound', 'Payé fournisseurs', 'money'),
      col('expenses', 'Payé dépenses', 'money'),
    ];
    const rows: TableRow[] = PAYMENT_METHODS.filter((method) => rowsByMethod.has(method)).map((method) => {
      const e = rowsByMethod.get(method)!;
      return {
        method: METHOD_LABEL[method]!,
        count: e.count,
        inbound: moneyOut(e.inbound),
        outbound: moneyOut(e.outbound),
        expenses: moneyOut(e.expenses),
      };
    });
    return done(columns, rows, totalsRow(columns, rows, ['count', 'inbound', 'outbound', 'expenses'], { key: 'method', text: 'Total' }));
  }

  private async payablesAgeing({ ctx, today, done }: Env): Promise<TableReport> {
    const [invoices, expenses] = await Promise.all([
      this.prisma.document.findMany({
        where: { companyId: ctx.companyId, type: 'PURCHASE_INVOICE', lifecycle: LIVE },
        select: {
          issueDate: true,
          dueDate: true,
          totalInclVat: true,
          paidAmount: true,
          contact: { select: { displayName: true } },
        },
      }),
      this.prisma.expense.findMany({
        where: { companyId: ctx.companyId, status: { in: [...OPEN_EXPENSE] } },
        select: {
          issueDate: true,
          dueDate: true,
          totalInclVat: true,
          paidAmount: true,
          supplier: { select: { displayName: true } },
          category: { select: { name: true } },
        },
      }),
    ]);

    const groups = new Map<string, Record<AgeingBucket, Decimal>>();
    const add = (label: string, due: Date, total: Decimal, paid: Decimal) => {
      const outstanding = total.minus(paid);
      if (outstanding.lte(0)) return;
      let entry = groups.get(label);
      if (!entry) {
        groups.set(label, (entry = { current: dec(0), d1_30: dec(0), d31_60: dec(0), d61_90: dec(0), d90_plus: dec(0) }));
      }
      const bucket = ageingBucket(daysBetween(isoDay(due), today));
      entry[bucket] = entry[bucket].plus(outstanding);
    };
    for (const invoice of invoices) {
      add(invoice.contact.displayName, invoice.dueDate ?? invoice.issueDate, dec(invoice.totalInclVat.toFixed()).abs(), dec(invoice.paidAmount.toFixed()).abs());
    }
    for (const expense of expenses) {
      add(expense.supplier?.displayName ?? expense.category.name, expense.dueDate ?? expense.issueDate, dec(expense.totalInclVat.toFixed()), dec(expense.paidAmount.toFixed()));
    }

    const columns = [
      col('supplier', 'Fournisseur / charge'),
      col('current', 'Non échu', 'money'),
      col('d1_30', '1-30 jours', 'money'),
      col('d31_60', '31-60 jours', 'money'),
      col('d61_90', '61-90 jours', 'money'),
      col('d90_plus', '+90 jours', 'money'),
      col('total', 'Total dû', 'money'),
    ];
    const rows: TableRow[] = [...groups.entries()]
      .map(([label, e]) => {
        const total = e.current.plus(e.d1_30).plus(e.d31_60).plus(e.d61_90).plus(e.d90_plus);
        return {
          supplier: label,
          current: moneyOut(e.current),
          d1_30: moneyOut(e.d1_30),
          d31_60: moneyOut(e.d31_60),
          d61_90: moneyOut(e.d61_90),
          d90_plus: moneyOut(e.d90_plus),
          total: moneyOut(total),
        };
      })
      .sort((a, b) => dec(b.total as string).comparedTo(dec(a.total as string)));
    return done(columns, rows, totalsRow(columns, rows, ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'total'], { key: 'supplier', text: 'Total' }), true);
  }

  private async margin({ ctx, q, from, to, done }: Env): Promise<TableReport> {
    const byCustomer = q.groupBy === 'customer';
    const lines = await this.prisma.documentLine.findMany({
      where: {
        isNote: false,
        document: {
          companyId: ctx.companyId,
          lifecycle: LIVE,
          type: { in: ['SALES_INVOICE', 'CREDIT_NOTE'] },
          issueDate: { gte: asDate(from), lte: asDate(to) },
        },
      },
      select: {
        variantId: true,
        sku: true,
        description: true,
        variantLabel: true,
        quantity: true,
        unitCost: true,
        taxableBase: true,
        document: { select: { type: true, contactId: true, contact: { select: { displayName: true } } } },
      },
    });

    const groups = new Map<string, { label: string; qty: Decimal; revenue: Decimal; cost: Decimal }>();
    for (const line of lines) {
      const sign = line.document.type === 'CREDIT_NOTE' ? -1 : 1;
      const key = byCustomer ? line.document.contactId : (line.variantId ?? `desc:${line.description}`);
      let entry = groups.get(key);
      if (!entry) {
        const label = byCustomer
          ? line.document.contact.displayName
          : [line.sku, line.description, line.variantLabel].filter(Boolean).join(' · ');
        groups.set(key, (entry = { label, qty: dec(0), revenue: dec(0), cost: dec(0) }));
      }
      entry.qty = entry.qty.plus(dec(line.quantity.toFixed()).abs().times(sign));
      entry.revenue = entry.revenue.plus(dec(line.taxableBase.toFixed()).abs().times(sign));
      if (line.unitCost !== null) {
        entry.cost = entry.cost.plus(dec(line.quantity.toFixed()).abs().times(dec(line.unitCost.toFixed())).times(sign));
      }
    }

    const grandRevenue = [...groups.values()].reduce((acc, g) => acc.plus(g.revenue), dec(0));
    const columns = [
      col('label', byCustomer ? 'Client' : 'Article'),
      col('quantity', 'Quantité', 'qty'),
      col('revenue', 'Chiffre d’affaires HT', 'money'),
      col('cost', 'Coût', 'money'),
      col('margin', 'Marge', 'money'),
      col('marginPct', 'Marge %', 'percent'),
      col('share', 'Part du CA %', 'percent'),
    ];
    const all: TableRow[] = [...groups.values()]
      .sort((a, b) => b.revenue.comparedTo(a.revenue))
      .map((g) => ({
        label: g.label,
        quantity: qtyOut(g.qty),
        revenue: moneyOut(g.revenue),
        cost: moneyOut(g.cost),
        margin: moneyOut(g.revenue.minus(g.cost)),
        marginPct: pct(g.revenue.minus(g.cost), g.revenue),
        share: pct(g.revenue, grandRevenue),
      }));
    const rows = all.slice(0, q.limit);
    const totals = totalsRow(columns, all, ['quantity', 'revenue', 'cost', 'margin'], { key: 'label', text: 'Total' });
    totals.marginPct = pct(totals.margin as string, totals.revenue as string);
    return done(columns, rows, totals);
  }

  // =========================================================================
  // Purchases and stock
  // =========================================================================

  private async purchases({ ctx, q, from, to, period, done }: Env): Promise<TableReport> {
    const groupBy = q.groupBy === 'product' ? 'product' : q.groupBy === 'period' ? 'period' : 'supplier';
    const where = {
      companyId: ctx.companyId,
      lifecycle: LIVE,
      type: 'PURCHASE_INVOICE' as const,
      issueDate: { gte: asDate(from), lte: asDate(to) },
    };
    const facts: SalesFact[] = [];

    if (groupBy === 'product') {
      const lines = await this.prisma.documentLine.findMany({
        where: { isNote: false, document: where },
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
      for (const line of lines) {
        facts.push({
          key: line.variantId ?? `desc:${line.description}`,
          label: [line.sku, line.description, line.variantLabel].filter(Boolean).join(' · '),
          documentId: line.documentId,
          sign: 1,
          exclVat: line.taxableBase.toFixed(),
          vat: line.vatAmount.toFixed(),
          inclVat: line.lineTotal.toFixed(),
          quantity: line.quantity.toFixed(),
        });
      }
    } else {
      const documents = await this.prisma.document.findMany({
        where,
        select: {
          id: true,
          issueDate: true,
          contactId: true,
          totalExclVat: true,
          totalVat: true,
          totalInclVat: true,
          contact: { select: { displayName: true } },
        },
      });
      for (const document of documents) {
        const key = groupBy === 'supplier' ? document.contactId : periodKey(document.issueDate, period);
        facts.push({
          key,
          label: groupBy === 'supplier' ? document.contact.displayName : key,
          documentId: document.id,
          sign: 1,
          exclVat: document.totalExclVat.toFixed(),
          vat: document.totalVat.toFixed(),
          inclVat: document.totalInclVat.toFixed(),
        });
      }
    }

    const grouped = groupSales(facts);
    const columns = [
      col('label', groupBy === 'supplier' ? 'Fournisseur' : groupBy === 'product' ? 'Article' : 'Période'),
      col('documents', 'Factures', 'int'),
      ...(groupBy === 'product' ? [col('quantity', 'Quantité', 'qty')] : []),
      col('exclVat', 'Total HT', 'money'),
      col('vat', 'TVA', 'money'),
      col('inclVat', 'Total TTC', 'money'),
    ];
    const rows: TableRow[] = grouped.rows.map((row) => ({
      label: row.label,
      documents: row.documentCount,
      ...(groupBy === 'product' ? { quantity: row.quantity } : {}),
      exclVat: row.totalExclVat,
      vat: row.totalVat,
      inclVat: row.totalInclVat,
    }));
    if (groupBy !== 'period') rows.sort((a, b) => dec(b.exclVat as string).comparedTo(dec(a.exclVat as string)));
    const totals: TableRow = {
      label: 'Total',
      documents: null,
      quantity: null,
      exclVat: grouped.totals.totalExclVat,
      vat: grouped.totals.totalVat,
      inclVat: grouped.totals.totalInclVat,
    };
    return done(columns, rows.slice(0, q.limit), totals);
  }

  private async stockMovements({ ctx, q, from, to, done }: Env): Promise<TableReport> {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        warehouse: { organizationId: ctx.organizationId },
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
        createdAt: { gte: asDate(from), lt: new Date(asDate(to).getTime() + 86_400_000) },
      },
      select: { type: true, quantity: true },
    });
    const groups = new Map<string, { count: number; inQty: Decimal; outQty: Decimal }>();
    for (const movement of movements) {
      let entry = groups.get(movement.type);
      if (!entry) groups.set(movement.type, (entry = { count: 0, inQty: dec(0), outQty: dec(0) }));
      entry.count++;
      const quantity = dec(movement.quantity.toFixed());
      if (quantity.gte(0)) entry.inQty = entry.inQty.plus(quantity);
      else entry.outQty = entry.outQty.plus(quantity.abs());
    }
    const columns = [
      col('type', 'Type de mouvement', 'label'),
      col('count', 'Mouvements', 'int'),
      col('inQty', 'Entrées', 'qty'),
      col('outQty', 'Sorties', 'qty'),
      col('net', 'Solde', 'qty'),
    ];
    const rows: TableRow[] = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, e]) => ({
        type: MOVEMENT_LABEL[type] ?? type,
        count: e.count,
        inQty: qtyOut(e.inQty),
        outQty: qtyOut(e.outQty),
        net: qtyOut(e.inQty.minus(e.outQty)),
      }));
    return done(columns, rows, totalsRow(columns, rows, ['count', 'inQty', 'outQty', 'net'], { key: 'type', text: 'Total' }));
  }

  private async lowStock({ ctx, q, done }: Env): Promise<TableReport> {
    const variants = await this.prisma.productVariant.findMany({
      where: { isActive: true, product: { organizationId: ctx.organizationId, isService: false } },
      select: {
        sku: true,
        variantLabel: true,
        minStockThreshold: true,
        product: { select: { name: true } },
        stockLevels: {
          where: q.warehouseId ? { warehouseId: q.warehouseId } : {},
          select: { onHand: true, incoming: true },
        },
      },
    });
    const rows: TableRow[] = [];
    for (const variant of variants) {
      const threshold = dec(variant.minStockThreshold.toFixed());
      const onHand = variant.stockLevels.reduce((acc, level) => acc.plus(dec(level.onHand.toFixed())), dec(0));
      const incoming = variant.stockLevels.reduce((acc, level) => acc.plus(dec(level.incoming.toFixed())), dec(0));
      if (!(threshold.gt(0) && onHand.lte(threshold)) && !onHand.lt(0)) continue;
      rows.push({
        sku: variant.sku,
        product: [variant.product.name, variant.variantLabel].filter(Boolean).join(' · '),
        onHand: qtyOut(onHand),
        threshold: qtyOut(threshold),
        shortfall: qtyOut(threshold.minus(onHand).clampedTo(0, Number.MAX_SAFE_INTEGER)),
        incoming: qtyOut(incoming),
      });
    }
    rows.sort((a, b) => dec(b.shortfall as string).comparedTo(dec(a.shortfall as string)));
    const columns = [
      col('sku', 'Référence'),
      col('product', 'Article'),
      col('onHand', 'En stock', 'qty'),
      col('threshold', 'Seuil', 'qty'),
      col('shortfall', 'Manque', 'qty'),
      col('incoming', 'En commande', 'qty'),
    ];
    return done(columns, rows.slice(0, q.limit), null, true);
  }

  private async slowMovers({ ctx, q, today, done }: Env): Promise<TableReport> {
    const since = new Date(asDate(today).getTime() - q.days * 86_400_000);
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        onHand: { gt: 0 },
        warehouse: { organizationId: ctx.organizationId },
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      },
      select: {
        variantId: true,
        onHand: true,
        averageCost: true,
        variant: { select: { sku: true, variantLabel: true, product: { select: { name: true } } } },
      },
    });
    const lastSales = await this.prisma.stockMovement.groupBy({
      by: ['variantId'],
      where: { type: 'SALE', warehouse: { organizationId: ctx.organizationId } },
      _max: { createdAt: true },
    });
    const lastSale = new Map(lastSales.map((row) => [row.variantId, row._max.createdAt]));

    const perVariant = new Map<string, { sku: string; label: string; onHand: Decimal; value: Decimal }>();
    for (const level of levels) {
      let entry = perVariant.get(level.variantId);
      if (!entry) {
        const label = [level.variant.product.name, level.variant.variantLabel].filter(Boolean).join(' · ');
        perVariant.set(level.variantId, (entry = { sku: level.variant.sku, label, onHand: dec(0), value: dec(0) }));
      }
      entry.onHand = entry.onHand.plus(dec(level.onHand.toFixed()));
      entry.value = entry.value.plus(dec(level.onHand.toFixed()).times(dec(level.averageCost.toFixed())));
    }

    const rows: TableRow[] = [];
    for (const [variantId, entry] of perVariant) {
      const last = lastSale.get(variantId) ?? null;
      if (last && last >= since) continue;
      rows.push({
        sku: entry.sku,
        product: entry.label,
        onHand: qtyOut(entry.onHand),
        value: moneyOut(entry.value),
        lastSale: last ? isoDay(last) : null,
        daysSince: last ? daysBetween(isoDay(last), today) : null,
      });
    }
    rows.sort((a, b) => dec(b.value as string).comparedTo(dec(a.value as string)));
    const columns = [
      col('sku', 'Référence'),
      col('product', 'Article'),
      col('onHand', 'En stock', 'qty'),
      col('value', 'Valeur du stock', 'money'),
      col('lastSale', 'Dernière vente', 'date'),
      col('daysSince', 'Jours sans vente', 'int'),
    ];
    return done(columns, rows.slice(0, q.limit), totalsRow(columns, rows, ['value'], { key: 'product', text: 'Total' }), true);
  }

  private async stockCounts({ ctx, q, from, to, done }: Env): Promise<TableReport> {
    const sessions = await this.prisma.stockCountSession.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
        startedAt: { gte: asDate(from), lt: new Date(asDate(to).getTime() + 86_400_000) },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        reference: true,
        status: true,
        startedAt: true,
        warehouse: { select: { name: true } },
        lines: { select: { expectedQuantity: true, countedQuantity: true } },
      },
    });
    const columns = [
      col('reference', 'Référence'),
      col('warehouse', 'Entrepôt'),
      col('status', 'Statut', 'label'),
      col('date', 'Date', 'date'),
      col('lines', 'Lignes', 'int'),
      col('counted', 'Comptées', 'int'),
      col('variance', 'Écart net', 'qty'),
      col('absVariance', 'Écart absolu', 'qty'),
    ];
    const rows: TableRow[] = sessions.map((session) => {
      let net = dec(0);
      let abs = dec(0);
      let counted = 0;
      for (const line of session.lines) {
        if (line.countedQuantity === null) continue;
        counted++;
        const diff = dec(line.countedQuantity.toFixed()).minus(dec(line.expectedQuantity.toFixed()));
        net = net.plus(diff);
        abs = abs.plus(diff.abs());
      }
      return {
        reference: session.reference,
        warehouse: session.warehouse.name,
        status: COUNT_STATUS_LABEL[session.status] ?? session.status,
        date: isoDay(session.startedAt),
        lines: session.lines.length,
        counted,
        variance: qtyOut(net),
        absVariance: qtyOut(abs),
      };
    });
    return done(columns, rows, null);
  }

  private async stockTransfers({ ctx, from, to, done }: Env): Promise<TableReport> {
    const transfers = await this.prisma.stockTransfer.findMany({
      where: {
        organizationId: ctx.organizationId,
        createdAt: { gte: asDate(from), lt: new Date(asDate(to).getTime() + 86_400_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        reference: true,
        status: true,
        createdAt: true,
        sourceWarehouse: { select: { name: true } },
        destinationWarehouse: { select: { name: true } },
        lines: { select: { quantity: true } },
      },
    });
    const columns = [
      col('reference', 'Référence'),
      col('source', 'Origine'),
      col('destination', 'Destination'),
      col('status', 'Statut', 'label'),
      col('date', 'Date', 'date'),
      col('lines', 'Lignes', 'int'),
      col('quantity', 'Quantité', 'qty'),
    ];
    const rows: TableRow[] = transfers.map((transfer) => ({
      reference: transfer.reference,
      source: transfer.sourceWarehouse.name,
      destination: transfer.destinationWarehouse.name,
      status: TRANSFER_STATUS_LABEL[transfer.status] ?? transfer.status,
      date: isoDay(transfer.createdAt),
      lines: transfer.lines.length,
      quantity: qtyOut(transfer.lines.reduce((acc, line) => acc.plus(dec(line.quantity.toFixed())), dec(0))),
    }));
    return done(columns, rows, totalsRow(columns, rows, ['lines', 'quantity'], { key: 'reference', text: 'Total' }));
  }

  // =========================================================================
  // Activity
  // =========================================================================

  private async cashUp({ ctx, q, from, to, done }: Env): Promise<TableReport> {
    const period: Period = q.period ?? 'day';
    const payments = await this.prisma.payment.findMany({
      where: { companyId: ctx.companyId, direction: 'INBOUND', paidAt: { gte: asDate(from), lte: asDate(to) } },
      select: { paidAt: true, method: true, amount: true },
    });
    const groups = new Map<string, { count: number; byMethod: Record<string, Decimal> }>();
    for (const payment of payments) {
      const key = periodKey(payment.paidAt, period);
      let entry = groups.get(key);
      if (!entry) groups.set(key, (entry = { count: 0, byMethod: {} }));
      entry.count++;
      entry.byMethod[payment.method] = (entry.byMethod[payment.method] ?? dec(0)).plus(dec(payment.amount.toFixed()));
    }
    const columns = [
      col('period', 'Période'),
      ...PAYMENT_METHODS.map((method) => col(method, METHOD_LABEL[method]!, 'money')),
      col('total', 'Total encaissé', 'money'),
      col('count', 'Opérations', 'int'),
    ];
    const rows: TableRow[] = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, e]) => {
        const row: TableRow = { period: key, count: e.count };
        let total = dec(0);
        for (const method of PAYMENT_METHODS) {
          const amount = e.byMethod[method] ?? dec(0);
          row[method] = moneyOut(amount);
          total = total.plus(amount);
        }
        row.total = moneyOut(total);
        return row;
      });
    return done(columns, rows, totalsRow(columns, rows, [...PAYMENT_METHODS, 'total', 'count'], { key: 'period', text: 'Total' }));
  }

  private async userActivity({ ctx, from, to, done }: Env): Promise<TableReport> {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        organizationId: ctx.organizationId,
        OR: [{ companyId: ctx.companyId }, { companyId: null }],
        createdAt: { gte: asDate(from), lt: new Date(asDate(to).getTime() + 86_400_000) },
      },
      select: { userId: true, entityType: true, createdAt: true, user: { select: { fullName: true } } },
    });
    const groups = new Map<string, { user: string; entity: string; count: number; last: Date }>();
    for (const entry of entries) {
      const key = `${entry.userId ?? '-'}|${entry.entityType}`;
      const group = groups.get(key);
      if (group) {
        group.count++;
        if (entry.createdAt > group.last) group.last = entry.createdAt;
      } else {
        groups.set(key, { user: entry.user?.fullName ?? '—', entity: entry.entityType, count: 1, last: entry.createdAt });
      }
    }
    const columns = [
      col('user', 'Utilisateur'),
      col('entity', 'Objet'),
      col('count', 'Actions', 'int'),
      col('last', 'Dernière action', 'date'),
    ];
    const rows: TableRow[] = [...groups.values()]
      .sort((a, b) => a.user.localeCompare(b.user) || b.count - a.count)
      .map((g) => ({ user: g.user, entity: g.entity, count: g.count, last: isoDay(g.last) }));
    return done(columns, rows, totalsRow(columns, rows, ['count'], { key: 'user', text: 'Total' }));
  }

  private async recurringRuns({ ctx, from, to, done }: Env): Promise<TableReport> {
    const runs = await this.prisma.recurringInvoiceRun.findMany({
      where: {
        recurring: { companyId: ctx.companyId },
        scheduledFor: { gte: asDate(from), lte: asDate(to) },
      },
      orderBy: { scheduledFor: 'desc' },
      select: {
        scheduledFor: true,
        status: true,
        error: true,
        recurring: { select: { name: true, contact: { select: { displayName: true } } } },
        document: { select: { number: true } },
      },
    });
    const columns = [
      col('date', 'Date prévue', 'date'),
      col('name', 'Facture récurrente'),
      col('customer', 'Client'),
      col('document', 'Facture'),
      col('status', 'Statut', 'label'),
      col('error', 'Erreur'),
    ];
    const rows: TableRow[] = runs.map((run) => ({
      date: isoDay(run.scheduledFor),
      name: run.recurring.name,
      customer: run.recurring.contact.displayName,
      document: run.document?.number ?? null,
      status: run.status === 'OK' ? 'Générée' : 'Échec',
      error: run.error,
    }));
    return done(columns, rows, null);
  }

  // =========================================================================
  // Expenses
  // =========================================================================

  private async expensesByCategory({ ctx, from, to, done }: Env): Promise<TableReport> {
    const expenses = await this.prisma.expense.findMany({
      where: {
        companyId: ctx.companyId,
        status: { in: [...COUNTED_EXPENSE] },
        issueDate: { gte: asDate(from), lte: asDate(to) },
      },
      select: {
        amountExclVat: true,
        vatAmount: true,
        totalInclVat: true,
        paidAmount: true,
        category: { select: { name: true } },
      },
    });
    const groups = new Map<string, { count: number; excl: Decimal; vat: Decimal; total: Decimal; paid: Decimal }>();
    for (const expense of expenses) {
      let entry = groups.get(expense.category.name);
      if (!entry) groups.set(expense.category.name, (entry = { count: 0, excl: dec(0), vat: dec(0), total: dec(0), paid: dec(0) }));
      entry.count++;
      entry.excl = entry.excl.plus(dec(expense.amountExclVat.toFixed()));
      entry.vat = entry.vat.plus(dec(expense.vatAmount.toFixed()));
      entry.total = entry.total.plus(dec(expense.totalInclVat.toFixed()));
      entry.paid = entry.paid.plus(dec(expense.paidAmount.toFixed()));
    }
    const grand = [...groups.values()].reduce((acc, g) => acc.plus(g.total), dec(0));
    const columns = [
      col('category', 'Catégorie', 'label'),
      col('count', 'Factures', 'int'),
      col('exclVat', 'Total HT', 'money'),
      col('vat', 'TVA', 'money'),
      col('total', 'Total TTC', 'money'),
      col('paid', 'Payé', 'money'),
      col('outstanding', 'Reste dû', 'money'),
      col('share', 'Part %', 'percent'),
    ];
    const rows: TableRow[] = [...groups.entries()]
      .sort(([, a], [, b]) => b.total.comparedTo(a.total))
      .map(([name, e]) => ({
        category: name,
        count: e.count,
        exclVat: moneyOut(e.excl),
        vat: moneyOut(e.vat),
        total: moneyOut(e.total),
        paid: moneyOut(e.paid),
        outstanding: moneyOut(e.total.minus(e.paid)),
        share: pct(e.total, grand),
      }));
    return done(columns, rows, totalsRow(columns, rows, ['count', 'exclVat', 'vat', 'total', 'paid', 'outstanding'], { key: 'category', text: 'Total' }));
  }

  private async utilityTrend({ ctx, q, from, to, period, done }: Env): Promise<TableReport> {
    const kinds = ['UTILITY', 'RENT', 'INSURANCE', 'FUEL', 'SUPPLIES', 'SALARY', 'TAX', 'OTHER'] as const;
    const kind = kinds.find((value) => value === q.kind) ?? 'UTILITY';
    const expenses = await this.prisma.expense.findMany({
      where: {
        companyId: ctx.companyId,
        status: { in: [...COUNTED_EXPENSE] },
        category: { kind },
        issueDate: { gte: asDate(from), lte: asDate(to) },
      },
      select: { issueDate: true, totalInclVat: true, category: { select: { name: true } } },
    });
    const categories = [...new Set(expenses.map((e) => e.category.name))].sort();
    const buckets = new Map<string, Map<string, Decimal>>();
    for (const expense of expenses) {
      const key = periodKey(expense.issueDate, period);
      let byCategory = buckets.get(key);
      if (!byCategory) buckets.set(key, (byCategory = new Map()));
      byCategory.set(expense.category.name, (byCategory.get(expense.category.name) ?? dec(0)).plus(dec(expense.totalInclVat.toFixed())));
    }
    const keyOf = (index: number) => `c${index}`;
    const columns = [
      col('period', 'Période'),
      ...categories.map((name, index) => ({ ...col(keyOf(index), name, 'money'), label: name })),
      col('total', 'Total', 'money'),
    ];
    const rows: TableRow[] = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, byCategory]) => {
        const row: TableRow = { period: key };
        let total = dec(0);
        categories.forEach((name, index) => {
          const amount = byCategory.get(name) ?? dec(0);
          row[keyOf(index)] = moneyOut(amount);
          total = total.plus(amount);
        });
        row.total = moneyOut(total);
        return row;
      });
    const sumKeys = [...categories.map((_, index) => keyOf(index)), 'total'];
    return done(columns, rows, totalsRow(columns, rows, sumKeys, { key: 'period', text: 'Total' }));
  }

  private async upcomingBills({ ctx, today, done }: Env): Promise<TableReport> {
    const [expenses, invoices] = await Promise.all([
      this.prisma.expense.findMany({
        where: { companyId: ctx.companyId, status: { in: [...OPEN_EXPENSE] } },
        select: {
          reference: true,
          description: true,
          issueDate: true,
          dueDate: true,
          totalInclVat: true,
          paidAmount: true,
          supplier: { select: { displayName: true } },
          category: { select: { name: true } },
        },
      }),
      this.prisma.document.findMany({
        where: { companyId: ctx.companyId, type: 'PURCHASE_INVOICE', lifecycle: LIVE },
        select: {
          number: true,
          issueDate: true,
          dueDate: true,
          totalInclVat: true,
          paidAmount: true,
          contact: { select: { displayName: true } },
        },
      }),
    ]);
    const rows: Array<TableRow & { _due: string }> = [];
    for (const expense of expenses) {
      const due = isoDay(expense.dueDate ?? expense.issueDate);
      const outstanding = dec(expense.totalInclVat.toFixed()).minus(dec(expense.paidAmount.toFixed()));
      rows.push({
        _due: due,
        due,
        daysLeft: daysBetween(today, due),
        supplier: expense.supplier?.displayName ?? expense.category.name,
        reference: expense.reference ?? expense.description,
        source: 'Dépense',
        total: moneyOut(expense.totalInclVat),
        outstanding: moneyOut(outstanding),
      });
    }
    for (const invoice of invoices) {
      const outstanding = dec(invoice.totalInclVat.toFixed()).abs().minus(dec(invoice.paidAmount.toFixed()).abs());
      if (outstanding.lte(0)) continue;
      const due = isoDay(invoice.dueDate ?? invoice.issueDate);
      rows.push({
        _due: due,
        due,
        daysLeft: daysBetween(today, due),
        supplier: invoice.contact.displayName,
        reference: invoice.number,
        source: 'Facture d’achat',
        total: moneyOut(dec(invoice.totalInclVat.toFixed()).abs()),
        outstanding: moneyOut(outstanding),
      });
    }
    rows.sort((a, b) => a._due.localeCompare(b._due));
    const columns = [
      col('due', 'Échéance', 'date'),
      col('daysLeft', 'Jours restants', 'int'),
      col('supplier', 'Fournisseur / charge'),
      col('reference', 'Référence'),
      col('source', 'Origine', 'label'),
      col('total', 'Total TTC', 'money'),
      col('outstanding', 'Reste dû', 'money'),
    ];
    const clean: TableRow[] = rows.map(({ _due: _ignored, ...row }) => row);
    return done(columns, clean, totalsRow(columns, clean, ['total', 'outstanding'], { key: 'supplier', text: 'Total' }), true);
  }


  // =========================================================================
  // Human resources and payroll
  // =========================================================================

  private async headcount({ ctx, from, to, done }: Env): Promise<TableReport> {
    const employees = await this.prisma.employee.findMany({
      where: { companyId: ctx.companyId },
      select: { hireDate: true, terminationDate: true, department: { select: { name: true } } },
    });
    const groups = new Map<string, { active: number; hired: number; left: number }>();
    for (const employee of employees) {
      const name = employee.department?.name ?? 'Sans département';
      const entry = groups.get(name) ?? { active: 0, hired: 0, left: 0 };
      const hire = isoDay(employee.hireDate);
      const left = employee.terminationDate ? isoDay(employee.terminationDate) : null;
      if (hire <= to && (left === null || left > to)) entry.active++;
      if (hire >= from && hire <= to) entry.hired++;
      if (left !== null && left >= from && left <= to) entry.left++;
      groups.set(name, entry);
    }
    const columns = [
      col('department', 'Département'),
      col('active', 'Effectif à la fin', 'int'),
      col('hired', 'Embauches', 'int'),
      col('left', 'Départs', 'int'),
    ];
    const rows: TableRow[] = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([department, e]) => ({ department, active: e.active, hired: e.hired, left: e.left }));
    return done(columns, rows, totalsRow(columns, rows, ['active', 'hired', 'left'], { key: 'department', text: 'Total' }));
  }

  private async leaveBalances({ ctx, to, done }: Env): Promise<TableReport> {
    const balances = await this.leave.balances(ctx, Number(to.slice(0, 4)));
    const columns = [
      col('employee', 'Employé'),
      col('type', 'Type de congé', 'label'),
      col('entitlement', 'Droits', 'qty'),
      col('taken', 'Pris', 'qty'),
      col('pending', 'En attente', 'qty'),
      col('remaining', 'Solde', 'qty'),
    ];
    const rows: TableRow[] = balances.map((row) => ({
      employee: row.employeeName,
      type: row.typeName,
      entitlement: row.entitlement,
      taken: row.taken,
      pending: row.pending,
      remaining: row.remaining,
    }));
    return done(columns, rows, null, true);
  }

  private async attendanceSummary({ ctx, from, to, done }: Env): Promise<TableReport> {
    const records = await this.prisma.attendanceRecord.findMany({
      where: { companyId: ctx.companyId, date: { gte: asDate(from), lte: asDate(to) } },
      select: {
        status: true,
        overtimeMinutes: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
      },
    });
    const groups = new Map<string, { name: string; number: string; counts: Record<string, number>; overtime: number }>();
    for (const record of records) {
      const key = record.employee.id;
      const entry =
        groups.get(key) ??
        { name: `${record.employee.firstName} ${record.employee.lastName}`, number: record.employee.employeeNumber, counts: {}, overtime: 0 };
      entry.counts[record.status] = (entry.counts[record.status] ?? 0) + 1;
      entry.overtime += record.overtimeMinutes;
      groups.set(key, entry);
    }
    const columns = [
      col('employee', 'Employé'),
      col('number', 'N°'),
      col('PRESENT', 'Présent', 'int'),
      col('LATE', 'En retard', 'int'),
      col('ABSENT', 'Absent', 'int'),
      col('LEAVE', 'En congé', 'int'),
      col('HOLIDAY', 'Jour férié', 'int'),
      col('overtime', 'Heures sup. (min)', 'int'),
    ];
    const rows: TableRow[] = [...groups.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({
        employee: g.name,
        number: g.number,
        PRESENT: g.counts.PRESENT ?? 0,
        LATE: g.counts.LATE ?? 0,
        ABSENT: g.counts.ABSENT ?? 0,
        LEAVE: g.counts.LEAVE ?? 0,
        HOLIDAY: g.counts.HOLIDAY ?? 0,
        overtime: g.overtime,
      }));
    return done(columns, rows, totalsRow(columns, rows, ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY', 'overtime'], { key: 'employee', text: 'Total' }));
  }

  /** Payslips of validated and paid runs whose month falls in the range. */
  private async payslipsInRange(ctx: RequestContext, from: string, to: string) {
    const fromKey = Number(from.slice(0, 4)) * 100 + Number(from.slice(5, 7));
    const toKey = Number(to.slice(0, 4)) * 100 + Number(to.slice(5, 7));
    const rows = await this.prisma.payslip.findMany({
      where: {
        run: { companyId: ctx.companyId, status: { in: ['VALIDATED', 'PAID'] }, year: { gte: Number(from.slice(0, 4)), lte: Number(to.slice(0, 4)) } },
      },
      include: {
        run: { select: { year: true, month: true } },
        employee: { select: { firstName: true, lastName: true, employeeNumber: true, cnssNumber: true, cin: true } },
      },
    });
    return rows
      .filter((row) => {
        const key = row.run.year * 100 + row.run.month;
        return key >= fromKey && key <= toKey;
      })
      .sort(
        (a, b) =>
          a.run.year * 100 + a.run.month - (b.run.year * 100 + b.run.month) ||
          a.employee.lastName.localeCompare(b.employee.lastName),
      );
  }

  private async payrollRegister({ ctx, from, to, done }: Env): Promise<TableReport> {
    const slips = await this.payslipsInRange(ctx, from, to);
    const columns = [
      col('period', 'Période'),
      col('employee', 'Employé'),
      col('gross', 'Salaire brut', 'money'),
      col('cnss', 'CNSS', 'money'),
      col('amo', 'AMO', 'money'),
      col('ir', 'IR', 'money'),
      col('other', 'Retenues et avances', 'money'),
      col('net', 'Net payé', 'money'),
      col('cost', 'Coût employeur', 'money'),
    ];
    const rows: TableRow[] = slips.map((slip) => {
      const other = dec(slip.grossSalary.toFixed())
        .minus(dec(slip.cnssEmployee.toFixed()))
        .minus(dec(slip.amoEmployee.toFixed()))
        .minus(dec(slip.incomeTax.toFixed()))
        .minus(dec(slip.netPay.toFixed()));
      return {
        period: `${slip.run.year}-${String(slip.run.month).padStart(2, '0')}`,
        employee: `${slip.employee.firstName} ${slip.employee.lastName}`,
        gross: moneyOut(slip.grossSalary),
        cnss: moneyOut(slip.cnssEmployee),
        amo: moneyOut(slip.amoEmployee),
        ir: moneyOut(slip.incomeTax),
        other: moneyOut(other),
        net: moneyOut(slip.netPay),
        cost: moneyOut(slip.employerCost),
      };
    });
    return done(columns, rows, totalsRow(columns, rows, ['gross', 'cnss', 'amo', 'ir', 'other', 'net', 'cost'], { key: 'period', text: 'Total' }));
  }

  /** What is owed to the CNSS each month, by employee: the basis of the monthly declaration. */
  private async cnssDeclaration({ ctx, from, to, done }: Env): Promise<TableReport> {
    const slips = await this.payslipsInRange(ctx, from, to);
    const columns = [
      col('period', 'Période'),
      col('cnssNumber', 'N° CNSS'),
      col('employee', 'Employé'),
      col('gross', 'Salaire brut', 'money'),
      col('base', 'Base plafonnée', 'money'),
      col('cnssEmployee', 'CNSS salarié', 'money'),
      col('cnssEmployer', 'CNSS employeur', 'money'),
      col('family', 'Allocations familiales', 'money'),
      col('training', 'Formation professionnelle', 'money'),
      col('amoEmployee', 'AMO salarié', 'money'),
      col('amoEmployer', 'AMO employeur', 'money'),
      col('total', 'Total à verser', 'money'),
    ];
    const rows: TableRow[] = slips.map((slip) => {
      const total = dec(slip.cnssEmployee.toFixed())
        .plus(dec(slip.cnssEmployer.toFixed()))
        .plus(dec(slip.familyAllowance.toFixed()))
        .plus(dec(slip.trainingTax.toFixed()))
        .plus(dec(slip.amoEmployee.toFixed()))
        .plus(dec(slip.amoEmployer.toFixed()))
        .plus(dec(slip.otherEmployer.toFixed()));
      return {
        period: `${slip.run.year}-${String(slip.run.month).padStart(2, '0')}`,
        cnssNumber: slip.employee.cnssNumber,
        employee: `${slip.employee.firstName} ${slip.employee.lastName}`,
        gross: moneyOut(slip.grossSalary),
        base: moneyOut(slip.cnssBase),
        cnssEmployee: moneyOut(slip.cnssEmployee),
        cnssEmployer: moneyOut(slip.cnssEmployer),
        family: moneyOut(slip.familyAllowance),
        training: moneyOut(slip.trainingTax),
        amoEmployee: moneyOut(slip.amoEmployee),
        amoEmployer: moneyOut(slip.amoEmployer),
        total: moneyOut(total),
      };
    });
    return done(columns, rows, totalsRow(columns, rows, ['gross', 'base', 'cnssEmployee', 'cnssEmployer', 'family', 'training', 'amoEmployee', 'amoEmployer', 'total'], { key: 'period', text: 'Total' }));
  }

  private async payrollByDepartment({ ctx, from, to, done }: Env): Promise<TableReport> {
    const slips = await this.payslipsInRange(ctx, from, to);
    const groups = new Map<string, { people: Set<string>; gross: Decimal; net: Decimal; cost: Decimal }>();
    for (const slip of slips) {
      const snapshot = slip.employeeSnapshot as { departmentName?: string | null } | null;
      const name = snapshot?.departmentName ?? 'Sans département';
      const entry = groups.get(name) ?? { people: new Set(), gross: dec(0), net: dec(0), cost: dec(0) };
      entry.people.add(slip.employeeId);
      entry.gross = entry.gross.plus(dec(slip.grossSalary.toFixed()));
      entry.net = entry.net.plus(dec(slip.netPay.toFixed()));
      entry.cost = entry.cost.plus(dec(slip.employerCost.toFixed()));
      groups.set(name, entry);
    }
    const grand = [...groups.values()].reduce((acc, g) => acc.plus(g.cost), dec(0));
    const columns = [
      col('department', 'Département'),
      col('people', 'Employés', 'int'),
      col('gross', 'Salaire brut', 'money'),
      col('net', 'Net payé', 'money'),
      col('cost', 'Coût employeur', 'money'),
      col('share', 'Part du coût %', 'percent'),
    ];
    const rows: TableRow[] = [...groups.entries()]
      .sort(([, a], [, b]) => b.cost.comparedTo(a.cost))
      .map(([department, g]) => ({
        department,
        people: g.people.size,
        gross: moneyOut(g.gross),
        net: moneyOut(g.net),
        cost: moneyOut(g.cost),
        share: pct(g.cost, grand),
      }));
    return done(columns, rows, totalsRow(columns, rows, ['gross', 'net', 'cost'], { key: 'department', text: 'Total' }));
  }

  private async irAnnual({ ctx, from, to, done }: Env): Promise<TableReport> {
    const slips = await this.payslipsInRange(ctx, from, to);
    const groups = new Map<string, { name: string; cin: string | null; gross: Decimal; taxable: Decimal; ir: Decimal; months: number }>();
    for (const slip of slips) {
      const entry =
        groups.get(slip.employeeId) ??
        { name: `${slip.employee.firstName} ${slip.employee.lastName}`, cin: slip.employee.cin, gross: dec(0), taxable: dec(0), ir: dec(0), months: 0 };
      entry.gross = entry.gross.plus(dec(slip.grossSalary.toFixed()));
      entry.taxable = entry.taxable.plus(dec(slip.taxableNet.toFixed()));
      entry.ir = entry.ir.plus(dec(slip.incomeTax.toFixed()));
      entry.months++;
      groups.set(slip.employeeId, entry);
    }
    const columns = [
      col('employee', 'Employé'),
      col('cin', 'CIN'),
      col('months', 'Mois', 'int'),
      col('gross', 'Salaire brut', 'money'),
      col('taxable', 'Net imposable', 'money'),
      col('ir', 'IR retenu', 'money'),
    ];
    const rows: TableRow[] = [...groups.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({ employee: g.name, cin: g.cin, months: g.months, gross: moneyOut(g.gross), taxable: moneyOut(g.taxable), ir: moneyOut(g.ir) }));
    return done(columns, rows, totalsRow(columns, rows, ['gross', 'taxable', 'ir'], { key: 'employee', text: 'Total' }));
  }

  // =========================================================================


  // =========================================================================
  // Point of sale
  // =========================================================================

  private async cashSessions({ ctx, from, to, done }: Env): Promise<TableReport> {
    const sessions = await this.prisma.cashSession.findMany({
      where: {
        register: { companyId: ctx.companyId },
        openedAt: { gte: asDate(from), lt: new Date(asDate(to).getTime() + 86_400_000) },
      },
      orderBy: { openedAt: 'asc' },
      include: { register: { select: { name: true } }, openedBy: { select: { fullName: true } } },
    });
    const sums = await this.prisma.payment.groupBy({
      by: ['cashSessionId'],
      where: { cashSessionId: { in: sessions.map((s) => s.id) }, direction: 'INBOUND' },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const bySession = new Map(sums.map((row) => [row.cashSessionId, row]));
    const columns = [
      col('date', 'Date', 'date'),
      col('register', 'Caisse'),
      col('number', 'N°', 'int'),
      col('cashier', 'Caissier'),
      col('status', 'Statut', 'label'),
      col('sales', 'Ventes', 'int'),
      col('total', 'Total encaissé', 'money'),
      col('expected', 'Espèces attendues', 'money'),
      col('counted', 'Espèces comptées', 'money'),
      col('difference', 'Écart', 'money'),
    ];
    const rows: TableRow[] = sessions.map((session) => {
      const s = bySession.get(session.id);
      return {
        date: isoDay(session.openedAt),
        register: session.register.name,
        number: session.number,
        cashier: session.openedBy.fullName,
        status: session.status === 'OPEN' ? 'Ouverte' : 'Clôturée',
        sales: s?._count._all ?? 0,
        total: moneyOut(s?._sum.amount ?? 0),
        expected: session.expectedCash ? moneyOut(session.expectedCash) : null,
        counted: session.countedCash ? moneyOut(session.countedCash) : null,
        difference: session.difference ? moneyOut(session.difference) : null,
      };
    });
    return done(columns, rows, totalsRow(columns, rows, ['sales', 'total', 'difference'], { key: 'register', text: 'Total' }));
  }

  private async cashMovements({ ctx, from, to, done }: Env): Promise<TableReport> {
    const movements = await this.prisma.cashMovement.findMany({
      where: {
        session: { register: { companyId: ctx.companyId } },
        createdAt: { gte: asDate(from), lt: new Date(asDate(to).getTime() + 86_400_000) },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        createdBy: { select: { fullName: true } },
        session: { select: { number: true, register: { select: { name: true } } } },
      },
    });
    const reasons: Record<string, string> = {
      DEPOSIT: 'Dépôt',
      WITHDRAWAL: 'Retrait',
      EXPENSE: 'Dépense',
      REFUND: 'Remboursement',
      OTHER: 'Autre',
    };
    const columns = [
      col('date', 'Date', 'date'),
      col('register', 'Caisse'),
      col('session', 'Session', 'int'),
      col('type', 'Sens', 'label'),
      col('reason', 'Motif', 'label'),
      col('amount', 'Montant', 'money'),
      col('user', 'Utilisateur'),
      col('note', 'Note'),
    ];
    let net = dec(0);
    const rows: TableRow[] = movements.map((m) => {
      net = m.type === 'IN' ? net.plus(dec(m.amount.toFixed())) : net.minus(dec(m.amount.toFixed()));
      return {
        date: isoDay(m.createdAt),
        register: m.session.register.name,
        session: m.session.number,
        type: m.type === 'IN' ? 'Entrée' : 'Sortie',
        reason: reasons[m.reason] ?? m.reason,
        amount: moneyOut(m.amount),
        user: m.createdBy.fullName,
        note: m.note,
      };
    });
    const totals: TableRow = { date: null, register: 'Solde net', session: null, type: null, reason: null, amount: moneyOut(net), user: null, note: null };
    return done(columns, rows, rows.length > 0 ? totals : null);
  }

  /** Pay and people data are guarded by their own subject, on top of report access. */
  private assertAbility(ctx: RequestContext, subjectName: 'Employee' | 'Leave' | 'Attendance' | 'Payroll' | 'Cash'): void {
    if (!ctx.ability.can('read', subjectName)) {
      throw AppError.forbidden('Your role may not view this report');
    }
  }

  private assertCan(ctx: RequestContext, kind: string): void {
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

interface Env {
  ctx: RequestContext;
  q: TableQuery;
  from: string;
  to: string;
  period: Period;
  today: string;
  done: (columns: TableColumn[], rows: TableRow[], totals?: TableRow | null, asOf?: boolean) => TableReport;
}

