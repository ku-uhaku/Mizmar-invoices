import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, meta as documentMeta } from '@mizmar/core';
import type { documentSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { decodeCursor, toPage, type Page } from '../common/util/cursor';
import { moneyOut, toPrismaDecimal } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { DocumentsService } from '../documents/documents.service';

type Payment = z.infer<typeof documentSchemas.payment>;
type PaymentCreate = z.infer<typeof documentSchemas.paymentCreate>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  async list(
    ctx: RequestContext,
    query: { contactId?: string; from?: string; to?: string; cursor?: string; limit: number },
  ): Promise<Page<Payment>> {
    this.assertCanRead(ctx);
    const cursor = decodeCursor(query.cursor);

    const rows = await this.prisma.payment.findMany({
      where: {
        companyId: ctx.companyId,
        ...(query.contactId ? { contactId: query.contactId } : {}),
        ...(query.from || query.to
          ? {
              paidAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
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
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: paymentInclude,
    });

    const page = toPage(rows, query.limit, (row) => ({
      value: row.createdAt.toISOString(),
      id: row.id,
    }));

    return { nextCursor: page.nextCursor, items: page.items.map((row) => mapPayment(row)) };
  }

  /**
   * Record a payment and allocate it across documents.
   *
   * Allocation is explicit by default; omitting an amount settles that document
   * as far as the remaining funds reach, oldest first — which is how a bank
   * transfer covering "the three oldest invoices" is actually applied.
   */
  async create(ctx: RequestContext, body: PaymentCreate): Promise<Payment> {
    if (!ctx.ability.can('create', 'Payment')) {
      throw AppError.forbidden('Your role may not record payments');
    }

    const documentIds = body.allocations.map((allocation) => allocation.documentId);
    const documents = await this.prisma.document.findMany({
      where: { id: { in: documentIds }, companyId: ctx.companyId },
      select: {
        id: true,
        type: true,
        contactId: true,
        number: true,
        lifecycle: true,
        currency: true,
        totalInclVat: true,
        paidAmount: true,
        issueDate: true,
      },
      orderBy: { issueDate: 'asc' },
    });

    if (documents.length !== new Set(documentIds).size) {
      throw AppError.notFound('One or more documents');
    }

    for (const document of documents) {
      if (document.contactId !== body.contactId) {
        throw AppError.badRequest(
          'CONTACT_MISMATCH',
          `${document.number ?? 'A document'} belongs to a different contact`,
        );
      }
      if (document.lifecycle === 'DRAFT' || document.lifecycle === 'CANCELLED') {
        throw AppError.unprocessable(
          'DOCUMENT_NOT_PAYABLE',
          `${document.number ?? 'A document'} must be validated before it can be paid`,
        );
      }
      if (!documentMeta(document.type).settles) {
        throw AppError.unprocessable(
          'DOCUMENT_NOT_PAYABLE',
          `A ${document.type} does not carry a balance`,
        );
      }
      if (body.currency && document.currency !== body.currency) {
        throw AppError.badRequest(
          'CURRENCY_MISMATCH',
          `${document.number ?? 'A document'} is in ${document.currency}, not ${body.currency}`,
        );
      }
    }

    // Payments against a purchase invoice leave the business; everything else
    // comes in. Mixing the two in one payment is meaningless, so it is refused.
    const directions = new Set(
      documents.map((document) => (document.type === 'PURCHASE_INVOICE' ? 'OUTBOUND' : 'INBOUND')),
    );
    if (directions.size > 1) {
      throw AppError.badRequest(
        'MIXED_DIRECTIONS',
        'A single payment cannot settle both a sale and a purchase',
      );
    }
    const direction = [...directions][0] ?? 'INBOUND';

    const amount = dec(body.amount);
    if (amount.lte(0)) {
      throw AppError.badRequest('INVALID_AMOUNT', 'A payment must be greater than zero');
    }

    const outstandingOf = (document: (typeof documents)[number]) =>
      dec(document.totalInclVat.toFixed())
        .abs()
        .minus(dec(document.paidAmount.toFixed()).abs());

    const requested = new Map(
      body.allocations.map((allocation) => [allocation.documentId, allocation.amount]),
    );

    let remaining = amount;
    const allocations: Array<{ documentId: string; amount: string }> = [];

    for (const document of documents) {
      const outstanding = outstandingOf(document);
      const explicit = requested.get(document.id);

      const take = explicit !== undefined ? dec(explicit) : minOf(outstanding, remaining);
      if (take.lte(0)) continue;

      if (take.gt(outstanding)) {
        throw AppError.unprocessable(
          'OVER_ALLOCATION',
          `${document.number ?? 'A document'} only has ${outstanding.toFixed(2)} outstanding`,
          { documentId: document.id, outstanding: outstanding.toFixed(2) },
        );
      }
      if (take.gt(remaining)) {
        throw AppError.unprocessable(
          'ALLOCATION_EXCEEDS_PAYMENT',
          'The allocations add up to more than the payment amount',
          { amount: amount.toFixed(2) },
        );
      }

      allocations.push({ documentId: document.id, amount: take.toFixed(2) });
      remaining = remaining.minus(take);
    }

    if (allocations.length === 0) {
      throw AppError.unprocessable(
        'NOTHING_TO_ALLOCATE',
        'Every selected document is already fully paid',
      );
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          companyId: ctx.companyId,
          contactId: body.contactId,
          direction,
          method: body.method,
          reference: body.reference ?? null,
          amount: toPrismaDecimal(amount),
          currency: body.currency ?? documents[0]!.currency,
          exchangeRate: toPrismaDecimal(body.exchangeRate ?? '1'),
          paidAt: new Date(body.paidAt),
          clearedAt: body.clearedAt ? new Date(body.clearedAt) : null,
          note: body.note ?? null,
          createdById: ctx.userId,
          allocations: {
            create: allocations.map((allocation) => ({
              documentId: allocation.documentId,
              amount: toPrismaDecimal(allocation.amount),
            })),
          },
        },
      });

      // Settlement and the cached paid amount are derived from allocations, so
      // they are recomputed rather than incremented.
      for (const allocation of allocations) {
        await this.documents.refreshSettlement(tx, allocation.documentId);
      }

      return payment.id;
    });

    const row = await this.prisma.payment.findUniqueOrThrow({
      where: { id },
      include: paymentInclude,
    });
    return mapPayment(row);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    if (!ctx.ability.can('delete', 'Payment')) {
      throw AppError.forbidden('Your role may not delete payments');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { id, companyId: ctx.companyId },
      include: { allocations: { select: { documentId: true } } },
    });
    if (!payment) throw AppError.notFound('Payment', id);

    await this.prisma.$transaction(async (tx) => {
      const affected = payment.allocations.map((allocation) => allocation.documentId);
      await tx.payment.delete({ where: { id } });
      for (const documentId of affected) {
        await this.documents.refreshSettlement(tx, documentId);
      }
    });
  }

  private assertCanRead(ctx: RequestContext): void {
    if (!ctx.ability.can('read', 'Payment')) {
      throw AppError.forbidden('Your role may not see payments');
    }
  }
}

function minOf(a: ReturnType<typeof dec>, b: ReturnType<typeof dec>): ReturnType<typeof dec> {
  return a.lte(b) ? a : b;
}

const paymentInclude = {
  contact: { select: { displayName: true } },
  allocations: {
    include: { document: { select: { number: true, type: true } } },
  },
} satisfies Prisma.PaymentInclude;

function mapPayment(
  row: Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>,
): Payment {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: row.contact.displayName,
    direction: row.direction,
    method: row.method,
    reference: row.reference,
    amount: moneyOut(row.amount),
    currency: row.currency,
    paidAt: row.paidAt.toISOString().slice(0, 10),
    clearedAt: row.clearedAt?.toISOString().slice(0, 10) ?? null,
    note: row.note,
    allocations: row.allocations.map((allocation) => ({
      documentId: allocation.documentId,
      documentNumber: allocation.document.number,
      documentType: allocation.document.type,
      amount: moneyOut(allocation.amount),
    })),
  };
}
