import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, RecurringInvoice } from '@prisma/client';
import { documentSchemas, recurringSchemas } from '@mizmar/contracts';
import {
  DEFAULT_TIMEZONE,
  localDate,
  occurrenceAt,
  type Occurrence,
  type ScheduleRule,
} from '@mizmar/core';
import { AuthService } from '../auth/auth.service';
import { AppError } from '../common/app-error';
import { DocumentDeliveryService } from '../documents/document-delivery.service';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';

/** Max occurrences generated per schedule per tick; the rest wait for the next tick. */
export const MAX_RUNS_PER_TICK = 5;
/** A schedule that fails this many times in a row is paused for a human to look at. */
export const MAX_CONSECUTIVE_FAILURES = 5;
/** Upper bound on schedules examined per tick. */
const MAX_SCHEDULES_PER_TICK = 200;

const toDateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);
const fromDateOnly = (date: Date) => date.toISOString().slice(0, 10);

export function ruleOf(schedule: RecurringInvoice): ScheduleRule {
  return {
    frequency: schedule.frequency,
    interval: schedule.interval,
    startDate: fromDateOnly(schedule.startDate),
    endDate: schedule.endDate ? fromDateOnly(schedule.endDate) : null,
    maxOccurrences: schedule.maxOccurrences,
  };
}

type Outcome = 'generated' | 'failed' | 'stop';

export interface RunResult {
  outcome: Outcome;
  runId?: string;
}

/**
 * Generates invoices from recurring schedules.
 *
 * Concurrency: every occurrence is generated inside one transaction that first
 * takes `SELECT ... FOR UPDATE SKIP LOCKED` on the schedule row. A second API
 * instance reaching the same schedule skips it instead of waiting, and the
 * unique (recurringId, scheduledFor) index on runs is the last line of defence.
 * The counter, the run row and the document are therefore all-or-nothing from
 * the point of view of any other instance.
 *
 * Actor: the scheduler acts as the schedule's creator, with their role, company
 * access and abilities re-resolved on every run. If that user is deactivated or
 * loses the right to create invoices, runs fail visibly (and the schedule is
 * auto-paused after repeated failures) rather than silently running with more
 * privilege than the creator has.
 */
@Injectable()
export class RecurringRunnerService {
  private readonly logger = new Logger(RecurringRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly delivery: DocumentDeliveryService,
    private readonly auth: AuthService,
  ) {}

  /** One scheduler pass. Failures are isolated per schedule. */
  async tick(now: Date = new Date()): Promise<{ generated: number; failed: number }> {
    // Compare against tomorrow's UTC date so every timezone's "today" is covered;
    // the exact per-timezone check happens under the lock.
    const horizon = toDateOnly(fromDateOnly(new Date(now.getTime() + 86_400_000)));
    const candidates = await this.prisma.recurringInvoice.findMany({
      where: { isActive: true, nextRunAt: { not: null, lte: horizon } },
      orderBy: { nextRunAt: 'asc' },
      select: { id: true },
      take: MAX_SCHEDULES_PER_TICK,
    });

    let generated = 0;
    let failed = 0;
    for (const { id } of candidates) {
      try {
        for (let i = 0; i < MAX_RUNS_PER_TICK; i++) {
          const result = await this.runNext(id, { now });
          if (result.outcome === 'generated') generated++;
          if (result.outcome === 'failed') failed++;
          if (result.outcome !== 'generated') break;
        }
      } catch (error) {
        failed++;
        this.logger.error(`Recurring schedule ${id} crashed: ${describe(error)}`);
      }
    }
    return { generated, failed };
  }

  /**
   * Generate the next occurrence of a schedule.
   *
   * Scheduled mode only runs when the occurrence is due in the schedule's
   * timezone and the schedule is active. Manual mode (run-now) runs it early,
   * dated today, as the calling user, and consumes that occurrence.
   */
  async runNext(
    id: string,
    options: { now?: Date; manual?: { ctx: RequestContext } } = {},
  ): Promise<RunResult> {
    const now = options.now ?? new Date();

    return this.prisma.$transaction(
      async (tx): Promise<RunResult> => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM recurring_invoices WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) return { outcome: 'stop' }; // another instance has it

        const schedule = await tx.recurringInvoice.findUnique({
          where: { id },
          include: { contact: { select: { email: true, displayName: true } } },
        });
        if (!schedule) return { outcome: 'stop' };
        if (!options.manual && !schedule.isActive) return { outcome: 'stop' };

        const rule = ruleOf(schedule);
        const occurrence = occurrenceAt(rule, schedule.occurrencesCount);
        if (!occurrence) {
          if (schedule.nextRunAt) {
            await tx.recurringInvoice.update({ where: { id }, data: { nextRunAt: null } });
          }
          return { outcome: 'stop' };
        }

        const timezone = schedule.timezone || DEFAULT_TIMEZONE;
        const today = localDate(now, timezone);
        if (!options.manual && occurrence.date > today) return { outcome: 'stop' };

        const scheduledFor = toDateOnly(occurrence.date);

        // Idempotency: this occurrence already produced a document (the counter
        // lagged, e.g. after a crash between steps). Catch the counter up only.
        const existing = await tx.recurringInvoiceRun.findUnique({
          where: { recurringId_scheduledFor: { recurringId: id, scheduledFor } },
        });
        if (existing?.status === 'OK') {
          await this.advance(tx, schedule, rule, existing.runAt, { resetFailures: false });
          return { outcome: 'generated', runId: existing.id };
        }

        const issueDate = options.manual ? today : occurrence.date;

        let documentId: string | null = null;
        let warning: string | null = null;
        try {
          const actor = options.manual?.ctx ?? (await this.actorFor(schedule));
          const created = await this.generate(actor, schedule, issueDate);
          documentId = created.id;
          warning = await this.finish(actor, schedule, created);
        } catch (error) {
          if (documentId === null) {
            return this.recordFailure(tx, schedule, occurrence, error);
          }
          warning = describe(error);
        }

        const run = await tx.recurringInvoiceRun.upsert({
          where: { recurringId_scheduledFor: { recurringId: id, scheduledFor } },
          create: { recurringId: id, documentId, scheduledFor, status: 'OK', error: warning },
          update: { documentId, status: 'OK', error: warning, runAt: now },
        });
        await this.advance(tx, schedule, rule, now, { resetFailures: true });
        return { outcome: 'generated', runId: run.id };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  // -------------------------------------------------------------------------

  /** Build the invoice through the same service the UI uses. */
  private async generate(actor: RequestContext, schedule: RecurringInvoice, issueDate: string) {
    const template = recurringSchemas.recurringTemplate.parse(schedule.template);
    const body = documentSchemas.documentCreate.parse({
      ...template,
      type: 'SALES_INVOICE',
      contactId: schedule.contactId,
      issueDate,
    });
    return this.documents.create(actor, body);
  }

  /**
   * Validate and email according to the mode. A failure here does not undo the
   * draft (it exists and is visible); it is reported as a warning on the run.
   */
  private async finish(
    actor: RequestContext,
    schedule: RecurringInvoice & { contact?: { email: string | null } },
    created: { id: string },
  ): Promise<string | null> {
    if (schedule.mode === 'DRAFT') return null;

    let number: string | null;
    try {
      const validated = await this.documents.validate(actor, created.id, false);
      number = validated.number;
    } catch (error) {
      return `Left as draft, validation failed: ${describe(error)}`;
    }

    if (schedule.mode !== 'VALIDATE_AND_EMAIL') return null;

    const to = schedule.contact?.email;
    if (!to) return 'Validated, but the customer has no email address';
    try {
      await this.delivery.sendByEmail(actor, created.id, {
        to: [to],
        subject: `Facture ${number ?? ''}`.trim(),
        body: `Bonjour,\n\nVeuillez trouver ci-joint la facture ${number ?? ''}.\n\nCordialement,\n${actor.organizationName}`,
        attachPdf: true,
      });
      return null;
    } catch (error) {
      return `Validated, but email failed: ${describe(error)}`;
    }
  }

  private async advance(
    tx: Prisma.TransactionClient,
    schedule: RecurringInvoice,
    rule: ScheduleRule,
    at: Date,
    options: { resetFailures: boolean },
  ): Promise<void> {
    const count = schedule.occurrencesCount + 1;
    const next = occurrenceAt(rule, count);
    await tx.recurringInvoice.update({
      where: { id: schedule.id },
      data: {
        occurrencesCount: count,
        nextRunAt: next ? toDateOnly(next.date) : null,
        lastRunAt: at,
        ...(options.resetFailures ? { consecutiveFailures: 0 } : {}),
      },
    });
  }

  private async recordFailure(
    tx: Prisma.TransactionClient,
    schedule: RecurringInvoice,
    occurrence: Occurrence,
    error: unknown,
  ): Promise<RunResult> {
    const message = describe(error);
    const scheduledFor = toDateOnly(occurrence.date);
    this.logger.warn(`Recurring "${schedule.name}" (${schedule.id}) failed: ${message}`);

    const run = await tx.recurringInvoiceRun.upsert({
      where: { recurringId_scheduledFor: { recurringId: schedule.id, scheduledFor } },
      create: { recurringId: schedule.id, scheduledFor, status: 'FAILED', error: message },
      update: { status: 'FAILED', error: message, runAt: new Date() },
    });

    const failures = schedule.consecutiveFailures + 1;
    await tx.recurringInvoice.update({
      where: { id: schedule.id },
      data: {
        consecutiveFailures: failures,
        // The occurrence is retried on the next tick; after repeated failures a
        // human has to look at it.
        ...(failures >= MAX_CONSECUTIVE_FAILURES ? { isActive: false } : {}),
      },
    });
    return { outcome: 'failed', runId: run.id };
  }

  /** The schedule creator, with their current role and company access. */
  private async actorFor(schedule: RecurringInvoice): Promise<RequestContext> {
    const company = await this.prisma.company.findUnique({
      where: { id: schedule.companyId },
      select: { organizationId: true },
    });
    if (!company) throw AppError.notFound('Company', schedule.companyId);

    const membership = await this.prisma.membership.findFirst({
      where: { userId: schedule.createdById, organizationId: company.organizationId },
      select: { id: true, user: { select: { email: true } } },
    });
    if (!membership) {
      throw AppError.forbidden('The user who created this schedule no longer has access');
    }

    return this.auth.loadContext(
      {
        sub: schedule.createdById,
        email: membership.user.email,
        organizationId: company.organizationId,
        membershipId: membership.id,
      },
      schedule.companyId,
    );
  }
}

function describe(error: unknown): string {
  if (error instanceof AppError) return `${error.code}: ${error.message}`.slice(0, 1000);
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error).slice(0, 1000);
}
