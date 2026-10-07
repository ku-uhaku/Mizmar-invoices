import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { recurringSchemas } from '@mizmar/contracts';
import {
  addMonthsClamped,
  DEFAULT_TIMEZONE,
  firstIndexOnOrAfter,
  isValidTimeZone,
  localDate,
  occurrenceAt,
  subject,
  type ScheduleRule,
} from '@mizmar/core';
import { AppError } from '../common/app-error';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { RecurringRunnerService, ruleOf } from './recurring-runner.service';

type Create = z.infer<typeof recurringSchemas.recurringCreate>;
type Update = z.infer<typeof recurringSchemas.recurringUpdate>;
type FromDocument = z.infer<typeof recurringSchemas.recurringFromDocument>;
type Template = z.infer<typeof recurringSchemas.recurringTemplate>;
type Schedule = z.infer<typeof recurringSchemas.recurringInvoice>;
type Run = z.infer<typeof recurringSchemas.recurringRun>;

const include = {
  contact: { select: { displayName: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.RecurringInvoiceInclude;

type Row = Prisma.RecurringInvoiceGetPayload<{ include: typeof include }>;

const toDateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/**
 * CRUD for recurring invoice schedules.
 *
 * Permissions reuse the invoice abilities: whoever may create a sales invoice
 * may manage schedules, and whoever may read sales invoices may read them.
 */
@Injectable()
export class RecurringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly runner: RecurringRunnerService,
  ) {}

  async list(ctx: RequestContext): Promise<Schedule[]> {
    this.assertCan(ctx, 'read');
    const rows = await this.prisma.recurringInvoice.findMany({
      where: { companyId: ctx.companyId },
      include,
      orderBy: [{ isActive: 'desc' }, { nextRunAt: { sort: 'asc', nulls: 'last' } }],
    });
    return rows.map(map);
  }

  async get(ctx: RequestContext, id: string): Promise<Schedule> {
    this.assertCan(ctx, 'read');
    return map(await this.load(ctx, id));
  }

  async create(ctx: RequestContext, body: Create): Promise<Schedule> {
    this.assertCan(ctx, 'create');
    await this.assertContact(ctx, body.contactId);
    const timezone = this.timezoneOf(body.timezone);
    const rule = this.ruleOf(body);

    const today = localDate(new Date(), timezone);
    const count = firstIndexOnOrAfter(rule, today);
    const next = occurrenceAt(rule, count);

    const row = await this.prisma.recurringInvoice.create({
      data: {
        companyId: ctx.companyId,
        contactId: body.contactId,
        name: body.name,
        template: body.template as Prisma.InputJsonValue,
        frequency: body.frequency,
        interval: body.interval,
        startDate: toDateOnly(body.startDate),
        endDate: body.endDate ? toDateOnly(body.endDate) : null,
        maxOccurrences: body.maxOccurrences ?? null,
        timezone,
        occurrencesCount: count,
        nextRunAt: next ? toDateOnly(next.date) : null,
        mode: body.mode,
        isActive: body.isActive,
        createdById: ctx.userId,
      },
      include,
    });
    return map(row);
  }

  /** "Créer depuis une facture existante": the invoice's lines become the template. */
  async fromDocument(ctx: RequestContext, documentId: string, body: FromDocument): Promise<Schedule> {
    const doc = await this.documents.get(ctx, documentId);
    if (doc.type !== 'SALES_INVOICE') {
      throw AppError.unprocessable('NOT_AN_INVOICE', 'Only sales invoices can be made recurring');
    }

    const template: Template = {
      billingAddressId: doc.billingAddressId,
      shippingAddressId: doc.shippingAddressId,
      warehouseId: doc.warehouseId,
      currency: doc.currency,
      exchangeRate: doc.exchangeRate,
      locale: doc.locale,
      priceMode: doc.priceMode,
      globalDiscount: doc.globalDiscountKind
        ? { kind: doc.globalDiscountKind, value: doc.globalDiscountValue ?? '0' }
        : null,
      shippingAmount: doc.shippingAmount,
      shippingVatRate: doc.shippingVatRate,
      returnToStock: doc.returnToStock,
      reference: doc.reference,
      projectName: doc.projectName,
      notes: doc.notes,
      terms: doc.terms,
      internalMemo: doc.internalMemo,
      templateConfigId: doc.templateConfigId,
      lines: doc.lines.map((line, index) => ({
        variantId: line.variantId,
        warehouseId: line.warehouseId,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        discount: line.discountKind
          ? { kind: line.discountKind, value: line.discountValue ?? '0' }
          : null,
        isNote: line.isNote,
        isService: line.isService,
        sortOrder: index + 1,
      })),
    };

    // The source invoice already covers the current period, so the first
    // generated one defaults to a period from now.
    const startDate =
      body.startDate ?? addMonthsClamped(localDate(new Date(), DEFAULT_TIMEZONE), 1);
    return this.create(ctx, {
      name: body.name ?? `${doc.contactName} - ${doc.number ?? doc.draftLabel ?? doc.id}`,
      contactId: doc.contactId,
      template,
      frequency: body.frequency,
      interval: body.interval,
      startDate,
      mode: body.mode,
      isActive: true,
    });
  }

  async update(ctx: RequestContext, id: string, body: Update): Promise<Schedule> {
    this.assertCan(ctx, 'create');
    const existing = await this.load(ctx, id);
    if (body.contactId) await this.assertContact(ctx, body.contactId);

    const merged = {
      frequency: body.frequency ?? existing.frequency,
      interval: body.interval ?? existing.interval,
      startDate: body.startDate ?? fromDateOnly(existing.startDate),
      endDate: body.endDate === undefined ? (existing.endDate ? fromDateOnly(existing.endDate) : null) : body.endDate,
      maxOccurrences: body.maxOccurrences === undefined ? existing.maxOccurrences : body.maxOccurrences,
    };
    const rule = this.ruleOf(merged);
    const timezone = body.timezone ? this.timezoneOf(body.timezone) : existing.timezone;

    // Changing the shape of the series (frequency, interval, start) re-anchors
    // it: occurrences before today are skipped rather than back-filled. Limit
    // changes (end date, max) keep the current position.
    const reanchor =
      body.frequency !== undefined || body.interval !== undefined || body.startDate !== undefined;
    const position = reanchor
      ? firstIndexOnOrAfter(rule, localDate(new Date(), timezone))
      : existing.occurrencesCount;
    const next = occurrenceAt(rule, position);

    const row = await this.prisma.recurringInvoice.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
        ...(body.template !== undefined ? { template: body.template as Prisma.InputJsonValue } : {}),
        ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
        ...(body.interval !== undefined ? { interval: body.interval } : {}),
        ...(body.startDate !== undefined ? { startDate: toDateOnly(body.startDate) } : {}),
        ...(body.endDate !== undefined ? { endDate: body.endDate ? toDateOnly(body.endDate) : null } : {}),
        ...(body.maxOccurrences !== undefined ? { maxOccurrences: body.maxOccurrences } : {}),
        ...(body.timezone !== undefined ? { timezone } : {}),
        ...(body.mode !== undefined ? { mode: body.mode } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.isActive === true ? { consecutiveFailures: 0 } : {}),
        occurrencesCount: position,
        nextRunAt: next ? toDateOnly(next.date) : null,
      },
      include,
    });
    return map(row);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    this.assertCan(ctx, 'create');
    await this.load(ctx, id);
    // Runs cascade; generated documents stay, only their link to the run goes.
    await this.prisma.recurringInvoice.delete({ where: { id } });
  }

  async pause(ctx: RequestContext, id: string): Promise<Schedule> {
    return this.update(ctx, id, { isActive: false });
  }

  /**
   * Resuming skips whatever fell due while paused (pausing means "do not bill
   * me for this period"); downtime without a pause is still caught up.
   */
  async resume(ctx: RequestContext, id: string): Promise<Schedule> {
    this.assertCan(ctx, 'create');
    const existing = await this.load(ctx, id);
    const rule = ruleOf(existing);
    const index = Math.max(
      existing.occurrencesCount,
      firstIndexOnOrAfter(rule, localDate(new Date(), existing.timezone)),
    );
    const next = occurrenceAt(rule, index);
    const row = await this.prisma.recurringInvoice.update({
      where: { id },
      data: {
        isActive: true,
        consecutiveFailures: 0,
        occurrencesCount: index,
        nextRunAt: next ? toDateOnly(next.date) : null,
      },
      include,
    });
    return map(row);
  }

  async runNow(ctx: RequestContext, id: string): Promise<Run> {
    this.assertCan(ctx, 'create');
    const existing = await this.load(ctx, id);
    if (!existing.nextRunAt) {
      throw AppError.conflict('SCHEDULE_COMPLETED', 'This schedule has no occurrences left');
    }
    const result = await this.runner.runNext(id, { manual: { ctx } });
    if (!result.runId) {
      throw AppError.conflict('RUN_IN_PROGRESS', 'This schedule is being processed, try again shortly');
    }
    const run = await this.prisma.recurringInvoiceRun.findUniqueOrThrow({
      where: { id: result.runId },
      include: { document: { select: { number: true } } },
    });
    return mapRun(run);
  }

  async runs(ctx: RequestContext, id: string): Promise<Run[]> {
    this.assertCan(ctx, 'read');
    await this.load(ctx, id);
    const rows = await this.prisma.recurringInvoiceRun.findMany({
      where: { recurringId: id },
      include: { document: { select: { number: true } } },
      orderBy: { runAt: 'desc' },
      take: 200,
    });
    return rows.map(mapRun);
  }

  // -------------------------------------------------------------------------

  private async load(ctx: RequestContext, id: string): Promise<Row> {
    const row = await this.prisma.recurringInvoice.findFirst({
      where: { id, companyId: ctx.companyId },
      include,
    });
    if (!row) throw AppError.notFound('Recurring invoice', id);
    return row;
  }

  private async assertContact(ctx: RequestContext, contactId: string): Promise<void> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!contact) throw AppError.notFound('Contact', contactId);
  }

  private timezoneOf(value: string | undefined): string {
    const timezone = value ?? DEFAULT_TIMEZONE;
    if (!isValidTimeZone(timezone)) {
      throw AppError.badRequest('INVALID_TIMEZONE', `Unknown timezone ${timezone}`);
    }
    return timezone;
  }

  private ruleOf(input: {
    frequency: ScheduleRule['frequency'];
    interval: number;
    startDate: string;
    endDate?: string | null;
    maxOccurrences?: number | null;
  }): ScheduleRule {
    if (input.endDate && input.endDate < input.startDate) {
      throw AppError.unprocessable('INVALID_SCHEDULE', 'The end date is before the start date');
    }
    return input;
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'create'): void {
    const allowed = ctx.ability.can(
      action,
      subject('Document', {
        companyId: ctx.companyId,
        side: 'SALES' as const,
        type: 'SALES_INVOICE' as const,
        lifecycle: 'DRAFT' as const,
        createdById: ctx.userId,
      }),
    );
    if (!allowed) throw AppError.forbidden('Your role may not manage recurring invoices');
  }
}

function map(row: Row): Schedule {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    contactId: row.contactId,
    contactName: row.contact.displayName,
    template: row.template as Template,
    frequency: row.frequency,
    interval: row.interval,
    startDate: fromDateOnly(row.startDate),
    endDate: row.endDate ? fromDateOnly(row.endDate) : null,
    maxOccurrences: row.maxOccurrences,
    timezone: row.timezone,
    nextRunAt: row.nextRunAt ? fromDateOnly(row.nextRunAt) : null,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    occurrencesCount: row.occurrencesCount,
    consecutiveFailures: row.consecutiveFailures,
    mode: row.mode,
    isActive: row.isActive,
    isCompleted: row.nextRunAt === null,
    createdById: row.createdById,
    createdByName: row.createdBy.fullName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapRun(
  row: Prisma.RecurringInvoiceRunGetPayload<{ include: { document: { select: { number: true } } } }>,
): Run {
  return {
    id: row.id,
    recurringId: row.recurringId,
    documentId: row.documentId,
    documentNumber: row.document?.number ?? null,
    scheduledFor: fromDateOnly(row.scheduledFor),
    runAt: row.runAt.toISOString(),
    status: row.status,
    error: row.error,
  };
}
