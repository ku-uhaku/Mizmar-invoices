import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec } from '@mizmar/core';
import type { treasurySchemas, documentSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut } from '../common/util/decimal';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { mapPayment, paymentInclude } from './payments.service';

type Status = z.infer<typeof treasurySchemas.paymentStatusEnum>;
type Payment = z.infer<typeof documentSchemas.payment>;
type ListResponse = z.infer<typeof treasurySchemas.chequeListResponse>;
type StatusChange = z.infer<typeof treasurySchemas.paymentStatusChange>;
type StatusEvent = z.infer<typeof treasurySchemas.paymentStatusEvent>;

const STATUSES: Status[] = ['PENDING', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'];

/** Where each status may go next. A bounced cheque can be presented again. */
const TRANSITIONS: Record<Status, Status[]> = {
  PENDING: ['DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'],
  DEPOSITED: ['CLEARED', 'BOUNCED', 'PENDING'],
  CLEARED: ['BOUNCED'],
  BOUNCED: ['PENDING', 'CANCELLED'],
  CANCELLED: [],
};

/** Statuses under which the payment still settles its documents. */
export const SETTLING: Status[] = ['PENDING', 'DEPOSITED', 'CLEARED'];

/** The follow-up screen for deferred instruments: cheques and bills of exchange. */
@Injectable()
export class ChequesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  async list(
    ctx: RequestContext,
    query: z.infer<typeof treasurySchemas.chequeListQuery>,
  ): Promise<ListResponse> {
    this.assertCan(ctx, 'read');

    const base: Prisma.PaymentWhereInput = {
      companyId: ctx.companyId,
      OR: [{ methodConfig: { deferred: true } }, { method: { in: ['CHEQUE', 'BILL_OF_EXCHANGE'] } }],
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.dueFrom || query.dueTo
        ? {
            dueDate: {
              ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
              ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            AND: [
              {
                OR: [
                  { reference: { contains: query.search, mode: 'insensitive' } },
                  { bankName: { contains: query.search, mode: 'insensitive' } },
                  { contact: { displayName: { contains: query.search, mode: 'insensitive' } } },
                ],
              },
            ],
          }
        : {}),
    };

    const [rows, grouped] = await Promise.all([
      this.prisma.payment.findMany({
        where: { ...base, ...(query.status ? { status: query.status } : {}) },
        // Soonest due first: that is the order a treasurer works through.
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { paidAt: 'desc' }],
        take: 500,
        include: paymentInclude,
      }),
      this.prisma.payment.groupBy({
        by: ['status'],
        where: base,
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    const summary = Object.fromEntries(
      STATUSES.map((status) => {
        const hit = grouped.find((row) => row.status === status);
        return [status, { count: hit?._count ?? 0, amount: moneyOut(hit?._sum.amount ?? dec(0)) }];
      }),
    ) as ListResponse['summary'];

    return { items: rows.map((row) => mapPayment(row)), summary };
  }

  async setStatus(ctx: RequestContext, id: string, body: StatusChange): Promise<Payment> {
    this.assertCan(ctx, 'update');

    const payment = await this.prisma.payment.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { allocations: { select: { documentId: true } } },
    });
    if (!payment) throw AppError.notFound('Payment', id);
    if (payment.status === body.status) return this.reload(id);

    if (!TRANSITIONS[payment.status].includes(body.status)) {
      throw AppError.unprocessable(
        'INVALID_TRANSITION',
        `A ${payment.status.toLowerCase()} payment cannot become ${body.status.toLowerCase()}`,
      );
    }

    const date = body.date ? new Date(body.date) : new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: {
          status: body.status,
          // The clearing date only means something while the payment is cleared.
          clearedAt: body.status === 'CLEARED' ? date : null,
        },
      });
      await tx.paymentStatusEvent.create({
        data: { paymentId: id, status: body.status, at: date, note: body.note ?? null, userId: ctx.userId },
      });

      // Bouncing or cancelling takes the money back out of the documents.
      if (SETTLING.includes(payment.status) !== SETTLING.includes(body.status)) {
        for (const allocation of payment.allocations) {
          await this.documents.refreshSettlement(tx, allocation.documentId);
        }
      }
    });

    return this.reload(id);
  }

  async history(ctx: RequestContext, id: string): Promise<StatusEvent[]> {
    this.assertCan(ctx, 'read');
    const payment = await this.prisma.payment.findFirst({
      where: { id, companyId: ctx.companyId },
      select: { id: true },
    });
    if (!payment) throw AppError.notFound('Payment', id);

    const events = await this.prisma.paymentStatusEvent.findMany({
      where: { paymentId: id },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
    });
    const userIds = [...new Set(events.map((event) => event.userId).filter((v): v is string => !!v))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((user) => [user.id, user.fullName]));

    return events.map((event) => ({
      id: event.id,
      status: event.status,
      at: event.at.toISOString(),
      note: event.note,
      userName: event.userId ? (names.get(event.userId) ?? null) : null,
    }));
  }

  private async reload(id: string): Promise<Payment> {
    const row = await this.prisma.payment.findUniqueOrThrow({ where: { id }, include: paymentInclude });
    return mapPayment(row);
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'update'): void {
    if (!ctx.ability.can(action, 'Payment')) {
      throw AppError.forbidden('Your role may not manage payments');
    }
  }
}
