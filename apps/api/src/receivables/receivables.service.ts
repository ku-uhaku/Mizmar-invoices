import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, daysOverdue, subject } from '@mizmar/core';
import type { Locale } from '@mizmar/i18n';
import type { receivablesSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut } from '../common/util/decimal';
import { MailService } from '../mail/mail.service';
import { PdfService } from '../pdf/pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import {
  bucketFor,
  buildAgeing,
  isWithinCooldown,
  reminderLevel,
  type AgeingInput,
} from './ageing';
import { buildReminderMessage, type ReminderLocale } from './reminder-template';

type OverdueResponse = z.infer<typeof receivablesSchemas.overdueResponse>;
type AgeingResponse = z.infer<typeof receivablesSchemas.ageingResponse>;
type RemindResponse = z.infer<typeof receivablesSchemas.remindResponse>;
type RemindRequest = z.infer<typeof receivablesSchemas.remindRequest>;
type ReminderRow = z.infer<typeof receivablesSchemas.reminderRow>;

const OPEN_SALES_INVOICES = {
  type: 'SALES_INVOICE',
  lifecycle: { in: ['VALIDATED', 'SENT'] },
  settlement: { in: ['UNPAID', 'PARTIAL'] },
} satisfies Prisma.DocumentWhereInput;

const invoiceSelect = {
  id: true,
  number: true,
  contactId: true,
  issueDate: true,
  dueDate: true,
  currency: true,
  locale: true,
  totalInclVat: true,
  paidAmount: true,
  contact: {
    select: { displayName: true, email: true, defaultLocale: true },
  },
  reminders: {
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  },
} satisfies Prisma.DocumentSelect;

type InvoiceRow = Prisma.DocumentGetPayload<{ select: typeof invoiceSelect }>;

@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger(ReceivablesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly pdf: PdfService,
  ) {}

  // =========================================================================
  // Overdue list
  // =========================================================================

  async overdue(
    ctx: RequestContext,
    query: { contactId?: string; bucket?: string },
  ): Promise<OverdueResponse> {
    this.assertCan(ctx, 'read');
    const now = new Date();
    const company = await this.currency(ctx);

    const rows = await this.prisma.document.findMany({
      where: {
        companyId: ctx.companyId,
        ...OPEN_SALES_INVOICES,
        dueDate: { lt: startOfToday(now) },
        ...(query.contactId ? { contactId: query.contactId } : {}),
      },
      orderBy: { dueDate: 'asc' },
      take: 1000,
      select: invoiceSelect,
    });

    let total = dec(0);
    const items: OverdueResponse['items'] = [];

    for (const row of rows) {
      const outstanding = outstandingOf(row);
      if (outstanding.lte(0) || !row.dueDate) continue;
      const bucket = bucketFor(row.dueDate, now);
      if (bucket === 'CURRENT') continue;
      if (query.bucket && bucket !== query.bucket) continue;

      total = total.plus(outstanding);
      items.push({
        documentId: row.id,
        number: row.number,
        contactId: row.contactId,
        contactName: row.contact.displayName,
        contactEmail: row.contact.email,
        issueDate: row.issueDate.toISOString().slice(0, 10),
        dueDate: row.dueDate.toISOString().slice(0, 10),
        currency: row.currency,
        totalInclVat: moneyOut(row.totalInclVat),
        paidAmount: moneyOut(row.paidAmount),
        outstanding: moneyOut(outstanding),
        daysOverdue: daysOverdue(row.dueDate, now),
        bucket,
        reminderCount: row.reminders.length,
        lastRemindedAt: row.reminders[0]?.sentAt.toISOString() ?? null,
      });
    }

    // Most overdue first: that is the order a collections call works through.
    items.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return { currency: company, totalOutstanding: moneyOut(total), items };
  }

  // =========================================================================
  // Ageing
  // =========================================================================

  async ageing(ctx: RequestContext): Promise<AgeingResponse> {
    this.assertCan(ctx, 'read');
    const now = new Date();
    const currency = await this.currency(ctx);

    const rows = await this.prisma.document.findMany({
      where: { companyId: ctx.companyId, ...OPEN_SALES_INVOICES },
      select: {
        contactId: true,
        dueDate: true,
        totalInclVat: true,
        paidAmount: true,
        contact: { select: { displayName: true } },
      },
    });

    const inputs: AgeingInput[] = rows.map((row) => ({
      contactId: row.contactId,
      contactName: row.contact.displayName,
      dueDate: row.dueDate,
      outstanding: outstandingOf(row).toFixed(),
    }));

    const { rows: ageingRows, totals } = buildAgeing(inputs, now);
    return { currency, asOf: now.toISOString().slice(0, 10), rows: ageingRows, totals };
  }

  // =========================================================================
  // Reminders
  // =========================================================================

  async remind(ctx: RequestContext, body: RemindRequest): Promise<RemindResponse> {
    this.assertCan(ctx, 'send');
    const now = new Date();

    const rows = await this.prisma.document.findMany({
      where: {
        companyId: ctx.companyId,
        ...OPEN_SALES_INVOICES,
        ...(body.documentIds?.length
          ? { id: { in: body.documentIds } }
          : { contactId: body.contactId }),
      },
      select: invoiceSelect,
    });

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { name: true, defaultLocale: true },
    });

    const results: RemindResponse['results'] = [];
    const byContact = new Map<string, InvoiceRow[]>();

    // Ids the caller named that are not open sales invoices of this company.
    const found = new Set(rows.map((row) => row.id));
    for (const id of body.documentIds ?? []) {
      if (!found.has(id)) {
        results.push({
          documentId: id,
          number: null,
          outcome: 'SKIPPED_NOT_OVERDUE',
          level: null,
          message: 'Not an unpaid sales invoice of this company',
        });
      }
    }

    for (const row of rows) {
      const isOverdue =
        row.dueDate !== null && daysOverdue(row.dueDate, now) > 0 && outstandingOf(row).gt(0);
      if (!isOverdue) {
        results.push({
          documentId: row.id,
          number: row.number,
          outcome: 'SKIPPED_NOT_OVERDUE',
          level: null,
          message: null,
        });
        continue;
      }
      if (!body.force && isWithinCooldown(row.reminders[0]?.sentAt ?? null, now)) {
        results.push({
          documentId: row.id,
          number: row.number,
          outcome: 'SKIPPED_RECENT',
          level: null,
          message: 'Reminded in the last 24 hours',
        });
        continue;
      }
      const list = byContact.get(row.contactId) ?? [];
      list.push(row);
      byContact.set(row.contactId, list);
    }

    let sent = 0;

    for (const invoices of byContact.values()) {
      const contact = invoices[0]!.contact;

      if (!contact.email) {
        for (const invoice of invoices) {
          results.push({
            documentId: invoice.id,
            number: invoice.number,
            outcome: 'NO_EMAIL',
            level: null,
            message: 'The contact has no email address',
          });
        }
        continue;
      }

      const locale = (body.locale ??
        contact.defaultLocale ??
        invoices[0]!.locale ??
        company.defaultLocale) as ReminderLocale;
      const level = Math.max(...invoices.map((i) => reminderLevel(i.reminders.length))) as
        | 1
        | 2
        | 3;

      const message = buildReminderMessage({
        locale,
        level,
        contactName: contact.displayName,
        companyName: company.name,
        invoices: invoices.map((invoice) => ({
          number: invoice.number ?? '',
          dueDate: invoice.dueDate!.toISOString().slice(0, 10),
          daysOverdue: daysOverdue(invoice.dueDate!, now),
          outstanding: moneyOut(outstandingOf(invoice)),
          currency: invoice.currency,
        })),
      });

      try {
        const attachments = body.attachPdf ? await this.attachments(ctx, invoices, locale) : undefined;
        await this.mail.send({
          to: [contact.email],
          subject: message.subject,
          body: message.body,
          attachments,
          replyTo: ctx.email,
        });
      } catch (error) {
        this.logger.warn(`Reminder to ${contact.email} failed: ${String(error)}`);
        for (const invoice of invoices) {
          results.push({
            documentId: invoice.id,
            number: invoice.number,
            outcome: 'FAILED',
            level: null,
            message: error instanceof Error ? error.message : 'Email could not be sent',
          });
        }
        continue;
      }

      await this.prisma.paymentReminder.createMany({
        data: invoices.map((invoice) => ({
          companyId: ctx.companyId,
          documentId: invoice.id,
          sentById: ctx.userId,
          channel: 'EMAIL' as const,
          level: reminderLevel(invoice.reminders.length),
          recipient: contact.email,
          sentAt: now,
        })),
      });

      for (const invoice of invoices) {
        sent += 1;
        results.push({
          documentId: invoice.id,
          number: invoice.number,
          outcome: 'SENT',
          level: reminderLevel(invoice.reminders.length),
          message: null,
        });
      }
    }

    return { results, sent };
  }

  async history(ctx: RequestContext, documentId: string): Promise<ReminderRow[]> {
    this.assertCan(ctx, 'read');
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, companyId: { in: ctx.companyIds } },
      select: { id: true },
    });
    if (!document) throw AppError.notFound('Document', documentId);

    const reminders = await this.prisma.paymentReminder.findMany({
      where: { documentId },
      orderBy: { sentAt: 'desc' },
    });
    const userIds = [...new Set(reminders.map((r) => r.sentById).filter((id): id is string => !!id))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((user) => [user.id, user.fullName]));

    return reminders.map((reminder) => ({
      id: reminder.id,
      sentAt: reminder.sentAt.toISOString(),
      sentByName: reminder.sentById ? (names.get(reminder.sentById) ?? null) : null,
      channel: reminder.channel,
      level: reminder.level,
      recipient: reminder.recipient,
    }));
  }

  // =========================================================================

  /** PDFs are best-effort: a render failure must not block the reminder itself. */
  private async attachments(ctx: RequestContext, invoices: InvoiceRow[], locale: Locale) {
    const files: Array<{ filename: string; content: Buffer; contentType: string }> = [];
    for (const invoice of invoices) {
      try {
        const { bytes, fileName } = await this.pdf.renderBytes(ctx, invoice.id, { locale });
        files.push({ filename: fileName, content: bytes, contentType: 'application/pdf' });
      } catch (error) {
        this.logger.warn(`PDF for ${invoice.number ?? invoice.id} not attached: ${String(error)}`);
      }
    }
    return files.length > 0 ? files : undefined;
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'send') {
    if (!ctx.ability.can(action, subject('Payment', { companyId: ctx.companyId }))) {
      throw AppError.forbidden('Your role may not access receivables');
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

function outstandingOf(row: { totalInclVat: Prisma.Decimal; paidAmount: Prisma.Decimal }) {
  return dec(row.totalInclVat.toFixed()).abs().minus(dec(row.paidAmount.toFixed()).abs());
}

function startOfToday(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
