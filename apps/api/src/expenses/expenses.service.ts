import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, localDate, type ScheduleRule } from '@mizmar/core';
import type { expenseSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { decodeCursor, toPage, type Page } from '../common/util/cursor';
import { moneyOut, rateOut, toPrismaDecimal } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import {
  expenseAmounts,
  isOverdue,
  nextOccurrenceAfter,
  plusDays,
  settlementStatus,
  type ExpenseStatusValue,
} from './expense-math';

type Expense = z.infer<typeof expenseSchemas.expense>;
type ExpenseCreate = z.infer<typeof expenseSchemas.expenseCreate>;
type ExpenseUpdate = z.infer<typeof expenseSchemas.expenseUpdate>;
type PaymentCreate = z.infer<typeof expenseSchemas.expensePaymentCreate>;
type Category = z.infer<typeof expenseSchemas.expenseCategory>;
type CategoryCreate = z.infer<typeof expenseSchemas.expenseCategoryCreate>;
type Recurring = z.infer<typeof expenseSchemas.recurringExpense>;
type RecurringCreate = z.infer<typeof expenseSchemas.recurringExpenseCreate>;
type RecurringUpdate = z.infer<typeof expenseSchemas.recurringExpenseUpdate>;

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const fromDate = (value: Date) => value.toISOString().slice(0, 10);
const todayOf = () => localDate(new Date());

/** Bills a recurring schedule may generate in one run, so a long pause catches up in steps. */
const MAX_GENERATED_PER_SCHEDULE = 12;

/** French names, as the UI translates them from the source text. */
const DEFAULT_CATEGORIES: Array<[string, Category['kind']]> = [
  ['Électricité', 'UTILITY'],
  ['Eau', 'UTILITY'],
  ['Internet / Wifi', 'UTILITY'],
  ['Téléphone', 'UTILITY'],
  ['Loyer', 'RENT'],
  ['Assurance', 'INSURANCE'],
  ['Carburant', 'FUEL'],
  ['Fournitures', 'SUPPLIES'],
  ['Salaires', 'SALARY'],
  ['Impôts et taxes', 'TAX'],
  ['Autres', 'OTHER'],
];

const expenseInclude = {
  category: { select: { name: true, kind: true } },
  supplier: { select: { displayName: true } },
  payments: { orderBy: { paidAt: 'asc' } },
} satisfies Prisma.ExpenseInclude;

const recurringInclude = {
  category: { select: { name: true } },
  supplier: { select: { displayName: true } },
} satisfies Prisma.RecurringExpenseInclude;

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  // -- Categories -------------------------------------------------------------

  async listCategories(ctx: RequestContext): Promise<Category[]> {
    this.assertCan(ctx, 'read');
    await this.ensureDefaultCategories(ctx.organizationId);
    const rows = await this.prisma.expenseCategory.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map(mapCategory);
  }

  async createCategory(ctx: RequestContext, body: CategoryCreate): Promise<Category> {
    this.assertCan(ctx, 'create');
    try {
      const row = await this.prisma.expenseCategory.create({
        data: { organizationId: ctx.organizationId, ...body },
      });
      return mapCategory(row);
    } catch (error) {
      throw this.uniqueToConflict(error, 'CATEGORY_EXISTS', 'A category with this name already exists');
    }
  }

  async updateCategory(
    ctx: RequestContext,
    id: string,
    body: Partial<CategoryCreate>,
  ): Promise<Category> {
    this.assertCan(ctx, 'update');
    const existing = await this.prisma.expenseCategory.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!existing) throw AppError.notFound('Expense category', id);
    try {
      return mapCategory(await this.prisma.expenseCategory.update({ where: { id }, data: body }));
    } catch (error) {
      throw this.uniqueToConflict(error, 'CATEGORY_EXISTS', 'A category with this name already exists');
    }
  }

  // -- Expenses ---------------------------------------------------------------

  async list(
    ctx: RequestContext,
    query: z.infer<typeof expenseSchemas.expenseListQuery>,
  ): Promise<Page<Expense>> {
    this.assertCan(ctx, 'read');
    const cursor = decodeCursor(query.cursor);
    const today = toDate(todayOf());

    const where: Prisma.ExpenseWhereInput = {
      companyId: ctx.companyId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.kind ? { category: { kind: query.kind } } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.overdue
        ? { status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: today } }
        : {}),
      ...(query.from || query.to
        ? {
            issueDate: {
              ...(query.from ? { gte: toDate(query.from) } : {}),
              ...(query.to ? { lte: toDate(query.to) } : {}),
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.value) } },
              { createdAt: new Date(cursor.value), id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.expense.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: expenseInclude,
    });
    const page = toPage(rows, query.limit, (row) => ({
      value: row.createdAt.toISOString(),
      id: row.id,
    }));
    const todayText = todayOf();
    return { nextCursor: page.nextCursor, items: page.items.map((row) => mapExpense(row, todayText)) };
  }

  async get(ctx: RequestContext, id: string): Promise<Expense> {
    this.assertCan(ctx, 'read');
    return mapExpense(await this.findOrThrow(ctx, id), todayOf());
  }

  async create(ctx: RequestContext, body: ExpenseCreate): Promise<Expense> {
    this.assertCan(ctx, 'create');
    await this.assertRefs(ctx, body.categoryId, body.supplierId);
    this.assertDates(body);

    const { net, vat, total } = expenseAmounts(body.amountExclVat, body.vatRate);
    const row = await this.prisma.expense.create({
      data: {
        companyId: ctx.companyId,
        categoryId: body.categoryId,
        supplierId: body.supplierId ?? null,
        reference: body.reference ?? null,
        description: body.description ?? null,
        issueDate: toDate(body.issueDate),
        dueDate: body.dueDate ? toDate(body.dueDate) : null,
        periodStart: body.periodStart ? toDate(body.periodStart) : null,
        periodEnd: body.periodEnd ? toDate(body.periodEnd) : null,
        currency: body.currency,
        amountExclVat: toPrismaDecimal(net),
        vatRate: toPrismaDecimal(body.vatRate),
        vatAmount: toPrismaDecimal(vat),
        totalInclVat: toPrismaDecimal(total),
        scanAssetId: body.scanAssetId ?? null,
        status: body.status,
        createdById: ctx.userId,
      },
      include: expenseInclude,
    });
    return mapExpense(row, todayOf());
  }

  async update(ctx: RequestContext, id: string, body: ExpenseUpdate): Promise<Expense> {
    this.assertCan(ctx, 'update');
    const existing = await this.findOrThrow(ctx, id);
    if (existing.status === 'CANCELLED') {
      throw AppError.unprocessable('EXPENSE_CANCELLED', 'A cancelled bill cannot be edited');
    }
    if (body.categoryId || body.supplierId) {
      await this.assertRefs(ctx, body.categoryId, body.supplierId);
    }
    this.assertDates(body);

    const data: Prisma.ExpenseUncheckedUpdateInput = {};
    if (body.categoryId) data.categoryId = body.categoryId;
    if (body.supplierId !== undefined) data.supplierId = body.supplierId;
    if (body.reference !== undefined) data.reference = body.reference;
    if (body.description !== undefined) data.description = body.description;
    if (body.issueDate) data.issueDate = toDate(body.issueDate);
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? toDate(body.dueDate) : null;
    if (body.periodStart !== undefined) data.periodStart = body.periodStart ? toDate(body.periodStart) : null;
    if (body.periodEnd !== undefined) data.periodEnd = body.periodEnd ? toDate(body.periodEnd) : null;
    if (body.currency) data.currency = body.currency;
    if (body.scanAssetId !== undefined) data.scanAssetId = body.scanAssetId;

    const touchesAmount = body.amountExclVat !== undefined || body.vatRate !== undefined;
    let total = dec(existing.totalInclVat.toFixed());
    if (touchesAmount) {
      const { net, vat, total: newTotal } = expenseAmounts(
        body.amountExclVat ?? existing.amountExclVat.toFixed(),
        body.vatRate ?? existing.vatRate.toFixed(),
      );
      if (newTotal.lt(dec(existing.paidAmount.toFixed()))) {
        throw AppError.unprocessable(
          'TOTAL_BELOW_PAID',
          'The total cannot be lower than what has already been paid',
        );
      }
      total = newTotal;
      data.amountExclVat = toPrismaDecimal(net);
      data.vatRate = toPrismaDecimal(body.vatRate ?? existing.vatRate.toFixed());
      data.vatAmount = toPrismaDecimal(vat);
      data.totalInclVat = toPrismaDecimal(newTotal);
    }

    // A draft can be published; anything that has payments settles from them.
    const requested = (body.status as ExpenseStatusValue | undefined) ?? (existing.status as ExpenseStatusValue);
    data.status = settlementStatus(requested, total.toFixed(2), existing.paidAmount.toFixed());

    const row = await this.prisma.expense.update({
      where: { id },
      data,
      include: expenseInclude,
    });
    return mapExpense(row, todayOf());
  }

  async cancel(ctx: RequestContext, id: string): Promise<Expense> {
    this.assertCan(ctx, 'update');
    const existing = await this.findOrThrow(ctx, id);
    if (dec(existing.paidAmount.toFixed()).gt(0)) {
      throw AppError.unprocessable(
        'EXPENSE_HAS_PAYMENTS',
        'Remove the payments before cancelling this bill',
      );
    }
    const row = await this.prisma.expense.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: expenseInclude,
    });
    return mapExpense(row, todayOf());
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    this.assertCan(ctx, 'delete');
    const existing = await this.findOrThrow(ctx, id);
    if (existing.payments.length > 0) {
      throw AppError.unprocessable(
        'EXPENSE_HAS_PAYMENTS',
        'A bill with payments cannot be deleted; cancel it after removing the payments',
      );
    }
    await this.prisma.expense.delete({ where: { id } });
  }

  async pay(ctx: RequestContext, id: string, body: PaymentCreate): Promise<Expense> {
    this.assertCan(ctx, 'create');
    await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!expense) throw AppError.notFound('Expense', id);
      if (expense.status === 'DRAFT' || expense.status === 'CANCELLED') {
        throw AppError.unprocessable(
          'EXPENSE_NOT_PAYABLE',
          'Only an open bill can receive payments',
        );
      }
      const outstanding = dec(expense.totalInclVat.toFixed()).minus(dec(expense.paidAmount.toFixed()));
      if (dec(body.amount).gt(outstanding)) {
        throw AppError.unprocessable(
          'OVER_PAYMENT',
          `Only ${outstanding.toFixed(2)} is outstanding on this bill`,
          { outstanding: outstanding.toFixed(2) },
        );
      }
      await tx.expensePayment.create({
        data: {
          expenseId: id,
          method: body.method,
          amount: toPrismaDecimal(body.amount),
          paidAt: toDate(body.paidAt),
          reference: body.reference ?? null,
          note: body.note ?? null,
          createdById: ctx.userId,
        },
      });
      await this.refreshSettlement(tx, id);
    });
    return mapExpense(await this.findOrThrow(ctx, id), todayOf());
  }

  async removePayment(ctx: RequestContext, id: string, paymentId: string): Promise<Expense> {
    this.assertCan(ctx, 'delete');
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.expensePayment.findFirst({
        where: { id: paymentId, expenseId: id, expense: { companyId: ctx.companyId } },
      });
      if (!payment) throw AppError.notFound('Expense payment', paymentId);
      await tx.expensePayment.delete({ where: { id: paymentId } });
      await this.refreshSettlement(tx, id);
    });
    return mapExpense(await this.findOrThrow(ctx, id), todayOf());
  }

  async summary(ctx: RequestContext): Promise<z.infer<typeof expenseSchemas.expenseSummary>> {
    this.assertCan(ctx, 'read');
    const today = todayOf();
    const soonLimit = plusDays(today, 7);
    const monthStart = `${today.slice(0, 7)}-01`;

    const open = await this.prisma.expense.findMany({
      where: { companyId: ctx.companyId, status: { in: ['UNPAID', 'PARTIAL'] } },
      select: { totalInclVat: true, paidAmount: true, dueDate: true },
    });
    let unpaid = dec(0);
    let overdue = dec(0);
    let overdueCount = 0;
    let soon = dec(0);
    let soonCount = 0;
    for (const row of open) {
      const left = dec(row.totalInclVat.toFixed()).minus(dec(row.paidAmount.toFixed()));
      unpaid = unpaid.plus(left);
      const due = row.dueDate ? fromDate(row.dueDate) : null;
      if (due && due < today) {
        overdue = overdue.plus(left);
        overdueCount++;
      } else if (due && due <= soonLimit) {
        soon = soon.plus(left);
        soonCount++;
      }
    }

    const month = await this.prisma.expense.aggregate({
      where: {
        companyId: ctx.companyId,
        status: { not: 'CANCELLED' },
        issueDate: { gte: toDate(monthStart) },
      },
      _sum: { totalInclVat: true },
    });
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { defaultCurrency: true },
    });

    return {
      currency: company.defaultCurrency,
      unpaidTotal: moneyOut(unpaid.toFixed()),
      overdueTotal: moneyOut(overdue.toFixed()),
      overdueCount,
      dueSoonTotal: moneyOut(soon.toFixed()),
      dueSoonCount: soonCount,
      monthTotal: moneyOut(month._sum.totalInclVat ?? 0),
    };
  }

  // -- Recurring --------------------------------------------------------------

  async listRecurring(ctx: RequestContext): Promise<Recurring[]> {
    this.assertCan(ctx, 'read');
    const rows = await this.prisma.recurringExpense.findMany({
      where: { companyId: ctx.companyId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: recurringInclude,
    });
    return rows.map(mapRecurring);
  }

  async createRecurring(ctx: RequestContext, body: RecurringCreate): Promise<Recurring> {
    this.assertCan(ctx, 'create');
    await this.assertRefs(ctx, body.categoryId, body.supplierId);
    if (body.endDate && body.endDate < body.startDate) {
      throw AppError.badRequest('INVALID_DATES', 'The end date is before the start date');
    }
    const row = await this.prisma.recurringExpense.create({
      data: {
        companyId: ctx.companyId,
        categoryId: body.categoryId,
        supplierId: body.supplierId ?? null,
        name: body.name,
        amountExclVat: toPrismaDecimal(body.amountExclVat),
        vatRate: toPrismaDecimal(body.vatRate),
        currency: body.currency,
        frequency: body.frequency,
        interval: body.interval,
        dueInDays: body.dueInDays,
        startDate: toDate(body.startDate),
        endDate: body.endDate ? toDate(body.endDate) : null,
        nextRunAt: toDate(body.startDate),
        isActive: body.isActive,
        createdById: ctx.userId,
      },
      include: recurringInclude,
    });
    return mapRecurring(row);
  }

  async updateRecurring(ctx: RequestContext, id: string, body: RecurringUpdate): Promise<Recurring> {
    this.assertCan(ctx, 'update');
    const existing = await this.prisma.recurringExpense.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw AppError.notFound('Recurring expense', id);
    if (body.categoryId || body.supplierId) await this.assertRefs(ctx, body.categoryId, body.supplierId);

    const data: Prisma.RecurringExpenseUncheckedUpdateInput = {};
    if (body.name) data.name = body.name;
    if (body.categoryId) data.categoryId = body.categoryId;
    if (body.supplierId !== undefined) data.supplierId = body.supplierId;
    if (body.amountExclVat !== undefined) data.amountExclVat = toPrismaDecimal(body.amountExclVat);
    if (body.vatRate !== undefined) data.vatRate = toPrismaDecimal(body.vatRate);
    if (body.currency) data.currency = body.currency;
    if (body.dueInDays !== undefined) data.dueInDays = body.dueInDays;
    if (body.endDate !== undefined) data.endDate = body.endDate ? toDate(body.endDate) : null;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    // Changing the cadence re-anchors the series on the (possibly new) start date.
    if (body.frequency || body.interval || body.startDate) {
      data.frequency = body.frequency ?? existing.frequency;
      data.interval = body.interval ?? existing.interval;
      const start = body.startDate ?? fromDate(existing.startDate);
      data.startDate = toDate(start);
      const today = todayOf();
      data.nextRunAt = toDate(start < today && existing.nextRunAt ? fromDate(existing.nextRunAt) : start);
    }
    const row = await this.prisma.recurringExpense.update({
      where: { id },
      data,
      include: recurringInclude,
    });
    return mapRecurring(row);
  }

  async removeRecurring(ctx: RequestContext, id: string): Promise<void> {
    this.assertCan(ctx, 'delete');
    const existing = await this.prisma.recurringExpense.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw AppError.notFound('Recurring expense', id);
    // Generated bills stay (their link is nulled by the schema).
    await this.prisma.recurringExpense.delete({ where: { id } });
  }

  /** Generates the due bills of one company (manual trigger). */
  async generateForCompany(ctx: RequestContext): Promise<number> {
    this.assertCan(ctx, 'create');
    return this.generateDue(ctx.companyId);
  }

  /**
   * Creates every bill whose schedule date has arrived. Idempotent: the unique
   * (recurringId, recurringPeriod) index turns a repeat into a no-op, so two API
   * instances ticking together cannot double-bill.
   */
  async generateDue(companyId?: string): Promise<number> {
    const today = todayOf();
    const schedules = await this.prisma.recurringExpense.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: toDate(today) },
        ...(companyId ? { companyId } : {}),
      },
      take: 200,
    });

    let generated = 0;
    for (const schedule of schedules) {
      const rule: ScheduleRule = {
        frequency: schedule.frequency,
        interval: schedule.interval,
        startDate: fromDate(schedule.startDate),
        endDate: schedule.endDate ? fromDate(schedule.endDate) : null,
      };
      let period = schedule.nextRunAt ? fromDate(schedule.nextRunAt) : null;

      for (let step = 0; period && period <= today && step < MAX_GENERATED_PER_SCHEDULE; step++) {
        const { net, vat, total } = expenseAmounts(
          schedule.amountExclVat.toFixed(),
          schedule.vatRate.toFixed(),
        );
        try {
          await this.prisma.expense.create({
            data: {
              companyId: schedule.companyId,
              categoryId: schedule.categoryId,
              supplierId: schedule.supplierId,
              description: schedule.name,
              issueDate: toDate(period),
              dueDate: toDate(plusDays(period, schedule.dueInDays)),
              currency: schedule.currency,
              amountExclVat: toPrismaDecimal(net),
              vatRate: schedule.vatRate,
              vatAmount: toPrismaDecimal(vat),
              totalInclVat: toPrismaDecimal(total),
              status: 'UNPAID',
              recurringId: schedule.id,
              recurringPeriod: toDate(period),
              createdById: schedule.createdById,
            },
          });
          generated++;
        } catch (error) {
          // Already generated for this period by another instance: carry on.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
            throw error;
          }
        }
        period = nextOccurrenceAfter(rule, period);
      }

      await this.prisma.recurringExpense.update({
        where: { id: schedule.id },
        data: { nextRunAt: period ? toDate(period) : null, isActive: period !== null },
      });
    }
    return generated;
  }

  // -- Internals --------------------------------------------------------------

  /** First use in an organisation: seed the usual utility and overhead categories. */
  private async ensureDefaultCategories(organizationId: string): Promise<void> {
    const count = await this.prisma.expenseCategory.count({ where: { organizationId } });
    if (count > 0) return;
    await this.prisma.expenseCategory.createMany({
      data: DEFAULT_CATEGORIES.map(([name, kind]) => ({ organizationId, name, kind })),
      skipDuplicates: true,
    });
  }

  /** Paid amount and status are derived from the payment rows, never incremented. */
  private async refreshSettlement(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const expense = await tx.expense.findUniqueOrThrow({ where: { id } });
    const sum = await tx.expensePayment.aggregate({
      where: { expenseId: id },
      _sum: { amount: true },
    });
    const paid = sum._sum.amount ?? new Prisma.Decimal(0);
    await tx.expense.update({
      where: { id },
      data: {
        paidAmount: paid,
        status: settlementStatus(
          expense.status as ExpenseStatusValue,
          expense.totalInclVat.toFixed(),
          paid.toFixed(),
        ),
      },
    });
  }

  private async findOrThrow(ctx: RequestContext, id: string) {
    const row = await this.prisma.expense.findFirst({
      where: { id, companyId: ctx.companyId },
      include: expenseInclude,
    });
    if (!row) throw AppError.notFound('Expense', id);
    return row;
  }

  private async assertRefs(
    ctx: RequestContext,
    categoryId?: string | null,
    supplierId?: string | null,
  ): Promise<void> {
    if (categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: categoryId, organizationId: ctx.organizationId, isActive: true },
        select: { id: true },
      });
      if (!category) throw AppError.notFound('Expense category', categoryId);
    }
    if (supplierId) {
      const supplier = await this.prisma.contact.findFirst({
        where: { id: supplierId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!supplier) throw AppError.notFound('Supplier', supplierId);
    }
  }

  private assertDates(body: {
    issueDate?: string;
    dueDate?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
  }): void {
    if (body.issueDate && body.dueDate && body.dueDate < body.issueDate) {
      throw AppError.badRequest('INVALID_DATES', 'The due date is before the issue date');
    }
    if (body.periodStart && body.periodEnd && body.periodEnd < body.periodStart) {
      throw AppError.badRequest('INVALID_DATES', 'The period ends before it starts');
    }
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'create' | 'update' | 'delete'): void {
    if (!ctx.ability.can(action, 'Expense')) {
      throw AppError.forbidden('Your role may not manage expenses');
    }
  }

  private uniqueToConflict(error: unknown, code: string, message: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return AppError.conflict(code, message);
    }
    return error;
  }
}

function mapCategory(row: { id: string; name: string; kind: Category['kind']; isActive: boolean }): Category {
  return { id: row.id, name: row.name, kind: row.kind, isActive: row.isActive };
}

function mapExpense(
  row: Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>,
  today: string,
): Expense {
  const outstanding = dec(row.totalInclVat.toFixed()).minus(dec(row.paidAmount.toFixed()));
  const dueDate = row.dueDate ? fromDate(row.dueDate) : null;
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    categoryKind: row.category.kind,
    supplierId: row.supplierId,
    supplierName: row.supplier?.displayName ?? null,
    reference: row.reference,
    description: row.description,
    issueDate: fromDate(row.issueDate),
    dueDate,
    periodStart: row.periodStart ? fromDate(row.periodStart) : null,
    periodEnd: row.periodEnd ? fromDate(row.periodEnd) : null,
    currency: row.currency,
    amountExclVat: moneyOut(row.amountExclVat),
    vatRate: rateOut(row.vatRate),
    vatAmount: moneyOut(row.vatAmount),
    totalInclVat: moneyOut(row.totalInclVat),
    paidAmount: moneyOut(row.paidAmount),
    outstanding: moneyOut(outstanding.toFixed()),
    status: row.status,
    isOverdue: isOverdue(row.status as ExpenseStatusValue, dueDate, today),
    scanAssetId: row.scanAssetId,
    recurringId: row.recurringId,
    payments: row.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      amount: moneyOut(payment.amount),
      paidAt: fromDate(payment.paidAt),
      reference: payment.reference,
      note: payment.note,
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapRecurring(
  row: Prisma.RecurringExpenseGetPayload<{ include: typeof recurringInclude }>,
): Recurring {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    supplierId: row.supplierId,
    supplierName: row.supplier?.displayName ?? null,
    amountExclVat: moneyOut(row.amountExclVat),
    vatRate: rateOut(row.vatRate),
    currency: row.currency,
    frequency: row.frequency,
    interval: row.interval,
    dueInDays: row.dueInDays,
    startDate: fromDate(row.startDate),
    endDate: row.endDate ? fromDate(row.endDate) : null,
    nextRunAt: row.nextRunAt ? fromDate(row.nextRunAt) : null,
    isActive: row.isActive,
  };
}
