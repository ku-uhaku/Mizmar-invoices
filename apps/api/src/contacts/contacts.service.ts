import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ageingBucket, dec, daysOverdue, subject } from '@mizmar/core';
import type { contactSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { decodeCursor, toPage, type Page } from '../common/util/cursor';
import { moneyOut, nullableMoneyOut, toPrismaDecimalOrNull } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';

type Contact = z.infer<typeof contactSchemas.contact>;
type ContactCreate = z.infer<typeof contactSchemas.contactCreate>;
type ContactUpdate = z.infer<typeof contactSchemas.contactUpdate>;
type ContactListQuery = z.infer<typeof contactSchemas.contactListQuery>;
type Statement = z.infer<typeof contactSchemas.statement>;
type StatementRow = z.infer<typeof contactSchemas.statementRow>;

/** Document types that move a contact's balance. */
const BALANCE_TYPES = ['SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_INVOICE'] as const;

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext, query: ContactListQuery): Promise<Page<Contact>> {
    const cursor = decodeCursor(query.cursor);

    const rows = await this.prisma.contact.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.kind
          ? // "BOTH" contacts must show up under both Clients and Suppliers.
            { kind: query.kind === 'BOTH' ? 'BOTH' : { in: [query.kind, 'BOTH'] } }
          : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(query.search
          ? {
              OR: [
                { displayName: { contains: query.search, mode: 'insensitive' } },
                { legalName: { contains: query.search, mode: 'insensitive' } },
                { code: { contains: query.search, mode: 'insensitive' } },
                { ice: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { displayName: { gt: cursor.value } },
                { displayName: cursor.value, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      include: contactInclude,
    });

    const balances = query.withBalances
      ? await this.balancesFor(ctx, rows.map((row) => row.id))
      : new Map();

    const page = toPage(rows, query.limit, (row) => ({
      value: row.displayName,
      id: row.id,
    }));

    return {
      nextCursor: page.nextCursor,
      items: page.items.map((row) => this.mapContact(row, balances.get(row.id))),
    };
  }

  async get(ctx: RequestContext, id: string): Promise<Contact> {
    const row = await this.loadContact(ctx, id);
    const balances = await this.balancesFor(ctx, [id]);
    return this.mapContact(row, balances.get(id));
  }

  async create(ctx: RequestContext, body: ContactCreate): Promise<Contact> {
    if (!ctx.ability.can('create', 'Contact')) {
      throw AppError.forbidden('Your role may not create contacts');
    }

    const row = await this.prisma.contact.create({
      data: {
        organizationId: ctx.organizationId,
        kind: body.kind,
        code: body.code ?? null,
        displayName: body.displayName,
        legalName: body.legalName ?? null,
        ice: body.ice ?? null,
        rc: body.rc ?? null,
        taxId: body.taxId ?? null,
        patente: body.patente ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        phone2: body.phone2 ?? null,
        website: body.website ?? null,
        paymentTerm: body.paymentTerm,
        paymentTermDays: body.paymentTermDays ?? null,
        creditLimit: toPrismaDecimalOrNull(body.creditLimit),
        defaultCurrency: body.defaultCurrency,
        defaultLocale: body.defaultLocale ?? null,
        vatExempt: body.vatExempt,
        priceListId: body.priceListId ?? null,
        notes: body.notes ?? null,
        createdById: ctx.userId,
        addresses: {
          create: (body.addresses ?? []).map((address, index) => ({
            kind: address.kind ?? 'BILLING',
            label: address.label ?? null,
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2 ?? null,
            city: address.city ?? null,
            postalCode: address.postalCode ?? null,
            country: address.country ?? 'MA',
            isDefault: address.isDefault ?? index === 0,
          })),
        },
        people: {
          create: (body.people ?? []).map((person) => ({
            fullName: person.fullName,
            role: person.role ?? null,
            email: person.email ?? null,
            phone: person.phone ?? null,
          })),
        },
      },
      include: contactInclude,
    });

    return this.mapContact(row);
  }

  async update(ctx: RequestContext, id: string, body: ContactUpdate): Promise<Contact> {
    const existing = await this.loadContact(ctx, id);
    if (
      !ctx.ability.can(
        'update',
        subject('Contact', { createdById: existing.createdById ?? '' }),
      )
    ) {
      throw AppError.forbidden('Your role may not edit this contact');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id },
        data: {
          ...(body.kind ? { kind: body.kind } : {}),
          ...(body.code !== undefined ? { code: body.code ?? null } : {}),
          ...(body.displayName ? { displayName: body.displayName } : {}),
          ...(body.legalName !== undefined ? { legalName: body.legalName ?? null } : {}),
          ...(body.ice !== undefined ? { ice: body.ice ?? null } : {}),
          ...(body.rc !== undefined ? { rc: body.rc ?? null } : {}),
          ...(body.taxId !== undefined ? { taxId: body.taxId ?? null } : {}),
          ...(body.patente !== undefined ? { patente: body.patente ?? null } : {}),
          ...(body.email !== undefined ? { email: body.email ?? null } : {}),
          ...(body.phone !== undefined ? { phone: body.phone ?? null } : {}),
          ...(body.phone2 !== undefined ? { phone2: body.phone2 ?? null } : {}),
          ...(body.website !== undefined ? { website: body.website ?? null } : {}),
          ...(body.paymentTerm ? { paymentTerm: body.paymentTerm } : {}),
          ...(body.paymentTermDays !== undefined
            ? { paymentTermDays: body.paymentTermDays ?? null }
            : {}),
          ...(body.creditLimit !== undefined
            ? { creditLimit: toPrismaDecimalOrNull(body.creditLimit) }
            : {}),
          ...(body.defaultCurrency ? { defaultCurrency: body.defaultCurrency } : {}),
          ...(body.defaultLocale !== undefined ? { defaultLocale: body.defaultLocale ?? null } : {}),
          ...(body.vatExempt !== undefined ? { vatExempt: body.vatExempt } : {}),
          ...(body.priceListId !== undefined ? { priceListId: body.priceListId ?? null } : {}),
          ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });

      // Addresses and people are replaced wholesale when supplied, but an
      // address referenced by a validated document is kept so that document
      // still renders the address it was issued to.
      if (body.addresses) {
        const referenced = await tx.contactAddress.findMany({
          where: {
            contactId: id,
            OR: [{ billingDocuments: { some: {} } }, { shippingDocuments: { some: {} } }],
          },
          select: { id: true },
        });
        await tx.contactAddress.deleteMany({
          where: { contactId: id, id: { notIn: referenced.map((r) => r.id) } },
        });
        for (const [index, address] of body.addresses.entries()) {
          await tx.contactAddress.create({
            data: {
              contactId: id,
              kind: address.kind ?? 'BILLING',
              label: address.label ?? null,
              addressLine1: address.addressLine1,
              addressLine2: address.addressLine2 ?? null,
              city: address.city ?? null,
              postalCode: address.postalCode ?? null,
              country: address.country ?? 'MA',
              isDefault: address.isDefault ?? index === 0,
            },
          });
        }
      }

      if (body.people) {
        await tx.contactPerson.deleteMany({ where: { contactId: id } });
        await tx.contactPerson.createMany({
          data: body.people.map((person) => ({
            contactId: id,
            fullName: person.fullName,
            role: person.role ?? null,
            email: person.email ?? null,
            phone: person.phone ?? null,
          })),
        });
      }

      return tx.contact.findUniqueOrThrow({ where: { id }, include: contactInclude });
    });

    return this.mapContact(row);
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const existing = await this.loadContact(ctx, id);
    if (!ctx.ability.can('manage', 'Contact')) {
      throw AppError.forbidden('Your role may not delete contacts');
    }

    const documentCount = await this.prisma.document.count({ where: { contactId: existing.id } });
    if (documentCount > 0) {
      // Deactivated rather than deleted: documents must keep their customer.
      await this.prisma.contact.update({ where: { id }, data: { isActive: false } });
      return;
    }
    await this.prisma.contact.delete({ where: { id } });
  }

  // =========================================================================
  // Account statement
  // =========================================================================

  /**
   * Aged account statement for one contact in the active company.
   *
   * Invoices are debits, credit notes and payments are credits, and the running
   * balance is what the contact owes after each line — which is the number a
   * collections call is actually made from.
   */
  async statement(
    ctx: RequestContext,
    contactId: string,
    range: { from?: string; to?: string },
  ): Promise<Statement> {
    const contact = await this.loadContact(ctx, contactId);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { defaultCurrency: true },
    });

    const to = range.to ? new Date(range.to) : new Date();
    const from = range.from ? new Date(range.from) : null;
    const now = new Date();

    const [documents, payments] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          companyId: ctx.companyId,
          contactId,
          lifecycle: { in: ['VALIDATED', 'SENT'] },
          type: { in: [...BALANCE_TYPES] },
          issueDate: { lte: to },
        },
        orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          type: true,
          number: true,
          issueDate: true,
          dueDate: true,
          totalInclVat: true,
          paidAmount: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { companyId: ctx.companyId, contactId, paidAt: { lte: to } },
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          reference: true,
          method: true,
          amount: true,
          paidAt: true,
          allocations: { select: { document: { select: { number: true } } } },
        },
      }),
    ]);

    type Entry = {
      at: Date;
      row: Omit<StatementRow, 'runningBalance'>;
      signed: ReturnType<typeof dec>;
    };

    const entries: Entry[] = [];

    for (const document of documents) {
      const total = dec(document.totalInclVat.toFixed());
      const paid = dec(document.paidAmount.toFixed());
      // A credit note reduces what is owed, so it lands in the credit column.
      const isCredit = document.type === 'CREDIT_NOTE';
      const magnitude = total.abs();
      const outstanding = magnitude.minus(paid.abs());
      const overdueDays = document.dueDate ? daysOverdue(document.dueDate, now) : 0;

      entries.push({
        at: document.issueDate,
        signed: isCredit ? magnitude.negated() : magnitude,
        row: {
          documentId: document.id,
          documentType: document.type,
          number: document.number,
          issueDate: document.issueDate.toISOString().slice(0, 10),
          dueDate: document.dueDate?.toISOString().slice(0, 10) ?? null,
          label: `${document.type} ${document.number ?? ''}`.trim(),
          debit: isCredit ? '0.00' : moneyOut(magnitude),
          credit: isCredit ? moneyOut(magnitude) : '0.00',
          outstanding: moneyOut(outstanding.isNegative() ? 0 : outstanding),
          daysOverdue: outstanding.gt(0) ? overdueDays : 0,
          ageingBucket: document.dueDate
            ? outstanding.gt(0)
              ? ageingBucket(document.dueDate, now)
              : 'CURRENT'
            : 'CURRENT',
        },
      });
    }

    for (const payment of payments) {
      const amount = dec(payment.amount.toFixed()).abs();
      const against = payment.allocations
        .map((allocation) => allocation.document.number)
        .filter(Boolean)
        .join(', ');

      entries.push({
        at: payment.paidAt,
        signed: amount.negated(),
        row: {
          documentId: payment.id,
          documentType: 'PAYMENT',
          number: payment.reference,
          issueDate: payment.paidAt.toISOString().slice(0, 10),
          dueDate: null,
          label: `Payment ${payment.method}${against ? ` — ${against}` : ''}`,
          debit: '0.00',
          credit: moneyOut(amount),
          outstanding: '0.00',
          daysOverdue: 0,
          ageingBucket: 'CURRENT',
        },
      });
    }

    entries.sort((a, b) => a.at.getTime() - b.at.getTime());

    // Everything before `from` is folded into one opening balance rather than
    // listed, which is what makes a dated statement readable.
    let openingBalance = dec(0);
    const visible: Entry[] = [];
    for (const entry of entries) {
      if (from && entry.at < from) openingBalance = openingBalance.plus(entry.signed);
      else visible.push(entry);
    }

    let running = openingBalance;
    const rows: StatementRow[] = visible.map((entry) => {
      running = running.plus(entry.signed);
      return { ...entry.row, runningBalance: moneyOut(running) };
    });

    const ageing = { CURRENT: dec(0), D1_30: dec(0), D31_60: dec(0), D61_90: dec(0), D90_PLUS: dec(0) };
    let totalInvoiced = dec(0);
    let totalOutstanding = dec(0);

    for (const document of documents) {
      if (document.type === 'CREDIT_NOTE') continue;
      const magnitude = dec(document.totalInclVat.toFixed()).abs();
      const outstanding = magnitude.minus(dec(document.paidAmount.toFixed()).abs());
      totalInvoiced = totalInvoiced.plus(magnitude);
      if (outstanding.lte(0)) continue;
      totalOutstanding = totalOutstanding.plus(outstanding);
      const bucket = document.dueDate ? ageingBucket(document.dueDate, now) : 'CURRENT';
      ageing[bucket] = ageing[bucket].plus(outstanding);
    }

    const totalPaid = payments.reduce(
      (acc, payment) => acc.plus(dec(payment.amount.toFixed()).abs()),
      dec(0),
    );

    const balances = await this.balancesFor(ctx, [contactId]);

    return {
      contact: this.mapContact(contact, balances.get(contactId)),
      companyId: ctx.companyId,
      currency: contact.defaultCurrency || company.defaultCurrency,
      from: from?.toISOString().slice(0, 10) ?? null,
      to: to.toISOString().slice(0, 10),
      openingBalance: moneyOut(openingBalance),
      closingBalance: moneyOut(running),
      totalInvoiced: moneyOut(totalInvoiced),
      totalPaid: moneyOut(totalPaid),
      totalOutstanding: moneyOut(totalOutstanding),
      ageing: {
        CURRENT: moneyOut(ageing.CURRENT),
        D1_30: moneyOut(ageing.D1_30),
        D31_60: moneyOut(ageing.D31_60),
        D61_90: moneyOut(ageing.D61_90),
        D90_PLUS: moneyOut(ageing.D90_PLUS),
      },
      rows,
    };
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private async loadContact(ctx: RequestContext, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId: ctx.organizationId },
      include: contactInclude,
    });
    if (!contact) throw AppError.notFound('Contact', id);
    return contact;
  }

  /** Outstanding and overdue totals per contact, for the directory list. */
  private async balancesFor(
    ctx: RequestContext,
    contactIds: string[],
  ): Promise<Map<string, { outstanding: string; overdue: string }>> {
    if (contactIds.length === 0) return new Map();

    const rows = await this.prisma.document.findMany({
      where: {
        companyId: ctx.companyId,
        contactId: { in: contactIds },
        lifecycle: { in: ['VALIDATED', 'SENT'] },
        settlement: { in: ['UNPAID', 'PARTIAL'] },
      },
      select: {
        contactId: true,
        type: true,
        dueDate: true,
        totalInclVat: true,
        paidAmount: true,
      },
    });

    const now = new Date();
    const result = new Map<string, { outstanding: ReturnType<typeof dec>; overdue: ReturnType<typeof dec> }>();

    for (const row of rows) {
      const outstanding = dec(row.totalInclVat.toFixed())
        .abs()
        .minus(dec(row.paidAmount.toFixed()).abs());
      if (outstanding.lte(0)) continue;

      const signed = row.type === 'CREDIT_NOTE' ? outstanding.negated() : outstanding;
      const entry =
        result.get(row.contactId) ?? { outstanding: dec(0), overdue: dec(0) };
      entry.outstanding = entry.outstanding.plus(signed);
      if (row.dueDate && row.dueDate < now && row.type !== 'CREDIT_NOTE') {
        entry.overdue = entry.overdue.plus(outstanding);
      }
      result.set(row.contactId, entry);
    }

    return new Map(
      [...result.entries()].map(([id, entry]) => [
        id,
        { outstanding: moneyOut(entry.outstanding), overdue: moneyOut(entry.overdue) },
      ]),
    );
  }

  private mapContact(
    row: Prisma.ContactGetPayload<{ include: typeof contactInclude }>,
    balances?: { outstanding: string; overdue: string },
  ): Contact {
    return {
      id: row.id,
      kind: row.kind,
      code: row.code,
      displayName: row.displayName,
      legalName: row.legalName,
      ice: row.ice,
      rc: row.rc,
      taxId: row.taxId,
      patente: row.patente,
      email: row.email,
      phone: row.phone,
      phone2: row.phone2,
      website: row.website,
      paymentTerm: row.paymentTerm,
      paymentTermDays: row.paymentTermDays,
      creditLimit: nullableMoneyOut(row.creditLimit),
      defaultCurrency: row.defaultCurrency,
      defaultLocale: row.defaultLocale,
      vatExempt: row.vatExempt,
      priceListId: row.priceListId,
      notes: row.notes,
      isActive: row.isActive,
      addresses: row.addresses.map((address) => ({
        id: address.id,
        kind: address.kind,
        label: address.label,
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        postalCode: address.postalCode,
        country: address.country,
        isDefault: address.isDefault,
      })),
      people: row.people.map((person) => ({
        id: person.id,
        fullName: person.fullName,
        role: person.role,
        email: person.email,
        phone: person.phone,
      })),
      ...(balances
        ? { outstandingBalance: balances.outstanding, overdueBalance: balances.overdue }
        : {}),
    };
  }
}

const contactInclude = {
  addresses: { orderBy: [{ isDefault: 'desc' }, { addressLine1: 'asc' }] },
  people: { orderBy: { fullName: 'asc' } },
} satisfies Prisma.ContactInclude;
