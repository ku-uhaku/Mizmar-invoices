import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec } from '@mizmar/core';
import type { cashSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut, toPrismaDecimal } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { cashDifference, expectedCash } from './cash-math';

type Register = z.infer<typeof cashSchemas.register>;
type RegisterBody = z.infer<typeof cashSchemas.registerBody>;
type SessionSummary = z.infer<typeof cashSchemas.sessionSummary>;
type SessionDetail = z.infer<typeof cashSchemas.sessionDetail>;
type SessionOpen = z.infer<typeof cashSchemas.sessionOpen>;
type SessionClose = z.infer<typeof cashSchemas.sessionClose>;
type MovementCreate = z.infer<typeof cashSchemas.movementCreate>;
type SessionListQuery = z.infer<typeof cashSchemas.sessionListQuery>;

const sessionInclude = {
  register: { select: { name: true, companyId: true } },
  openedBy: { select: { fullName: true } },
  closedBy: { select: { fullName: true } },
} satisfies Prisma.CashSessionInclude;
type SessionRow = Prisma.CashSessionGetPayload<{ include: typeof sessionInclude }>;

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

interface Figures {
  salesCount: number;
  salesTotal: ReturnType<typeof dec>;
  cashSales: ReturnType<typeof dec>;
  cashIn: ReturnType<typeof dec>;
  cashOut: ReturnType<typeof dec>;
}

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  // -- Registers --------------------------------------------------------------

  async listRegisters(ctx: RequestContext): Promise<Register[]> {
    this.assertCan(ctx, 'read');
    // A company that has never used the till gets its first register for free.
    if ((await this.prisma.cashRegister.count({ where: { companyId: ctx.companyId } })) === 0) {
      await this.prisma.cashRegister.createMany({
        data: [{ companyId: ctx.companyId, name: 'Caisse 1' }],
        skipDuplicates: true,
      });
    }
    const rows = await this.prisma.cashRegister.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { name: 'asc' },
      include: {
        sessions: {
          where: { status: 'OPEN' },
          take: 1,
          include: { openedBy: { select: { fullName: true } } },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.isActive,
      openSession: row.sessions[0]
        ? {
            id: row.sessions[0].id,
            number: row.sessions[0].number,
            openedAt: row.sessions[0].openedAt.toISOString(),
            openedByName: row.sessions[0].openedBy.fullName,
          }
        : null,
    }));
  }

  async createRegister(ctx: RequestContext, body: RegisterBody): Promise<Register> {
    this.assertCan(ctx, 'delete'); // managing registers is a manager's job
    try {
      const row = await this.prisma.cashRegister.create({
        data: { companyId: ctx.companyId, name: body.name.trim(), isActive: body.isActive },
      });
      return { id: row.id, name: row.name, isActive: row.isActive, openSession: null };
    } catch (error) {
      throw this.duplicate(error);
    }
  }

  async updateRegister(ctx: RequestContext, id: string, body: Partial<RegisterBody>): Promise<Register> {
    this.assertCan(ctx, 'delete');
    const existing = await this.prisma.cashRegister.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!existing) throw AppError.notFound('Register', id);
    if (body.isActive === false) {
      const open = await this.prisma.cashSession.count({ where: { registerId: id, status: 'OPEN' } });
      if (open > 0) {
        throw AppError.unprocessable('SESSION_OPEN', 'Close the open session before deactivating this register');
      }
    }
    try {
      await this.prisma.cashRegister.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
    } catch (error) {
      throw this.duplicate(error);
    }
    const all = await this.listRegisters(ctx);
    return all.find((register) => register.id === id)!;
  }

  // -- Sessions ---------------------------------------------------------------

  async list(ctx: RequestContext, query: SessionListQuery): Promise<SessionSummary[]> {
    this.assertCan(ctx, 'read');
    const rows = await this.prisma.cashSession.findMany({
      where: {
        register: { companyId: ctx.companyId },
        ...(query.registerId ? { registerId: query.registerId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to
          ? {
              openedAt: {
                ...(query.from ? { gte: toDate(query.from) } : {}),
                ...(query.to ? { lt: new Date(toDate(query.to).getTime() + 86_400_000) } : {}),
              },
            }
          : {}),
      },
      orderBy: { openedAt: 'desc' },
      take: query.limit,
      include: sessionInclude,
    });
    const figures = await this.figuresFor(rows.map((row) => row.id));
    return rows.map((row) => this.summary(row, figures.get(row.id) ?? emptyFigures()));
  }

  async open(ctx: RequestContext, body: SessionOpen): Promise<SessionDetail> {
    this.assertCan(ctx, 'create');
    await this.assertEnabled(ctx);
    const register = await this.prisma.cashRegister.findFirst({
      where: { id: body.registerId, companyId: ctx.companyId },
    });
    if (!register) throw AppError.notFound('Register', body.registerId);
    if (!register.isActive) {
      throw AppError.unprocessable('REGISTER_INACTIVE', 'This register is switched off');
    }

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const open = await tx.cashSession.findFirst({
          where: { registerId: register.id, status: 'OPEN' },
          select: { id: true },
        });
        if (open) {
          throw AppError.conflict('SESSION_ALREADY_OPEN', 'A session is already open on this register');
        }
        const last = await tx.cashSession.aggregate({
          where: { registerId: register.id },
          _max: { number: true },
        });
        const session = await tx.cashSession.create({
          data: {
            registerId: register.id,
            number: (last._max.number ?? 0) + 1,
            openedById: ctx.userId,
            openingFloat: toPrismaDecimal(body.openingFloat),
            openingNote: body.note ?? null,
          },
        });
        return session.id;
      });
      return this.detail(ctx, id);
    } catch (error) {
      // Two cashiers opening at once compute the same number; the unique index lets only one win.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict('SESSION_ALREADY_OPEN', 'A session is already open on this register');
      }
      throw error;
    }
  }

  async get(ctx: RequestContext, id: string): Promise<SessionDetail> {
    this.assertCan(ctx, 'read');
    return this.detail(ctx, id);
  }

  async addMovement(ctx: RequestContext, id: string, body: MovementCreate): Promise<SessionDetail> {
    this.assertCan(ctx, 'create');
    await this.assertEnabled(ctx);
    const session = await this.sessionOrThrow(ctx, id);
    if (session.status !== 'OPEN') {
      throw AppError.unprocessable('SESSION_CLOSED', 'This session is closed');
    }
    if (body.type === 'OUT') {
      const figures = (await this.figuresFor([id])).get(id) ?? emptyFigures();
      const inDrawer = dec(
        expectedCash({
          openingFloat: session.openingFloat.toFixed(),
          cashSales: figures.cashSales,
          cashIn: figures.cashIn,
          cashOut: figures.cashOut,
        }),
      );
      if (dec(body.amount).gt(inDrawer)) {
        throw AppError.unprocessable(
          'NOT_ENOUGH_CASH',
          `Only ${inDrawer.toFixed(2)} is in the drawer`,
          { inDrawer: inDrawer.toFixed(2) },
        );
      }
    }
    await this.prisma.cashMovement.create({
      data: {
        sessionId: id,
        type: body.type,
        reason: body.reason,
        amount: toPrismaDecimal(body.amount),
        note: body.note ?? null,
        createdById: ctx.userId,
      },
    });
    return this.detail(ctx, id);
  }

  async close(ctx: RequestContext, id: string, body: SessionClose): Promise<SessionDetail> {
    this.assertCan(ctx, 'update');
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.cashSession.findFirst({
        where: { id, register: { companyId: ctx.companyId } },
      });
      if (!session) throw AppError.notFound('Cash session', id);
      if (session.status !== 'OPEN') {
        throw AppError.unprocessable('SESSION_CLOSED', 'This session is already closed');
      }
      const figures = (await this.figuresFor([id], tx)).get(id) ?? emptyFigures();
      const expected = expectedCash({
        openingFloat: session.openingFloat.toFixed(),
        cashSales: figures.cashSales,
        cashIn: figures.cashIn,
        cashOut: figures.cashOut,
      });
      await tx.cashSession.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: ctx.userId,
          expectedCash: toPrismaDecimal(expected),
          countedCash: toPrismaDecimal(body.countedCash),
          difference: toPrismaDecimal(cashDifference(body.countedCash, expected)),
          closingNote: body.note ?? null,
        },
      });
    });
    return this.detail(ctx, id);
  }

  // -- Internals --------------------------------------------------------------

  private async detail(ctx: RequestContext, id: string): Promise<SessionDetail> {
    const row = await this.sessionOrThrow(ctx, id);
    const [figures, movements, payments, company] = await Promise.all([
      this.figuresFor([id]),
      this.prisma.cashMovement.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: 'asc' },
        include: { createdBy: { select: { fullName: true } } },
      }),
      this.prisma.payment.findMany({
        where: { cashSessionId: id, direction: 'INBOUND' },
        orderBy: { createdAt: 'asc' },
        include: { allocations: { include: { document: { select: { number: true } } } } },
      }),
      this.prisma.company.findUniqueOrThrow({
        where: { id: ctx.companyId },
        select: { defaultCurrency: true },
      }),
    ]);
    const f = figures.get(id) ?? emptyFigures();

    const methods = new Map<string, { count: number; amount: ReturnType<typeof dec> }>();
    for (const payment of payments) {
      const entry = methods.get(payment.method) ?? { count: 0, amount: dec(0) };
      entry.count++;
      entry.amount = entry.amount.plus(dec(payment.amount.toFixed()));
      methods.set(payment.method, entry);
    }

    return {
      ...this.summary(row, f),
      openingNote: row.openingNote,
      closingNote: row.closingNote,
      currency: company.defaultCurrency,
      byMethod: [...methods.entries()].map(([method, e]) => ({
        method: method as SessionDetail['byMethod'][number]['method'],
        count: e.count,
        amount: moneyOut(e.amount),
      })),
      cashSales: moneyOut(f.cashSales),
      cashIn: moneyOut(f.cashIn),
      cashOut: moneyOut(f.cashOut),
      movements: movements.map((m) => ({
        id: m.id,
        type: m.type,
        reason: m.reason,
        amount: moneyOut(m.amount),
        note: m.note,
        createdByName: m.createdBy.fullName,
        createdAt: m.createdAt.toISOString(),
      })),
      sales: payments.map((p) => ({
        paymentId: p.id,
        paidAt: p.paidAt.toISOString().slice(0, 10),
        time: p.createdAt.toISOString(),
        method: p.method,
        amount: moneyOut(p.amount),
        documentNumbers: p.allocations.map((a) => a.document.number).filter((n): n is string => Boolean(n)),
      })),
    };
  }

  private summary(row: SessionRow, f: Figures): SessionSummary {
    // An open session shows the live expectation; a closed one shows what was frozen at close.
    const live = expectedCash({
      openingFloat: row.openingFloat.toFixed(),
      cashSales: f.cashSales,
      cashIn: f.cashIn,
      cashOut: f.cashOut,
    });
    return {
      id: row.id,
      number: row.number,
      registerId: row.registerId,
      registerName: row.register.name,
      status: row.status,
      openedAt: row.openedAt.toISOString(),
      openedByName: row.openedBy.fullName,
      closedAt: row.closedAt?.toISOString() ?? null,
      closedByName: row.closedBy?.fullName ?? null,
      openingFloat: moneyOut(row.openingFloat),
      salesTotal: moneyOut(f.salesTotal),
      salesCount: f.salesCount,
      expectedCash: row.expectedCash ? moneyOut(row.expectedCash) : live,
      countedCash: row.countedCash ? moneyOut(row.countedCash) : null,
      difference: row.difference ? moneyOut(row.difference) : null,
    };
  }

  /** Sales and drawer movements per session, in two grouped queries. */
  private async figuresFor(
    ids: string[],
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, Figures>> {
    const out = new Map<string, Figures>();
    if (ids.length === 0) return out;
    const entry = (id: string) => {
      let f = out.get(id);
      if (!f) out.set(id, (f = emptyFigures()));
      return f;
    };
    const [payments, movements] = await Promise.all([
      client.payment.groupBy({
        by: ['cashSessionId', 'method'],
        where: { cashSessionId: { in: ids }, direction: 'INBOUND' },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      client.cashMovement.groupBy({
        by: ['sessionId', 'type'],
        where: { sessionId: { in: ids } },
        _sum: { amount: true },
      }),
    ]);
    for (const row of payments) {
      const f = entry(row.cashSessionId!);
      const amount = dec((row._sum.amount ?? 0).toString());
      f.salesCount += row._count._all;
      f.salesTotal = f.salesTotal.plus(amount);
      if (row.method === 'CASH') f.cashSales = f.cashSales.plus(amount);
    }
    for (const row of movements) {
      const f = entry(row.sessionId);
      const amount = dec((row._sum.amount ?? 0).toString());
      if (row.type === 'IN') f.cashIn = f.cashIn.plus(amount);
      else f.cashOut = f.cashOut.plus(amount);
    }
    return out;
  }

  private async sessionOrThrow(ctx: RequestContext, id: string): Promise<SessionRow> {
    const row = await this.prisma.cashSession.findFirst({
      where: { id, register: { companyId: ctx.companyId } },
      include: sessionInclude,
    });
    if (!row) throw AppError.notFound('Cash session', id);
    return row;
  }

  /** The till can be switched off per company; the open/move calls then refuse. */
  private async assertEnabled(ctx: RequestContext): Promise<void> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { posEnabled: true },
    });
    if (!company.posEnabled) {
      throw AppError.unprocessable('POS_DISABLED', 'The point of sale is switched off for this company');
    }
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'create' | 'update' | 'delete'): void {
    if (!ctx.ability.can(action, 'Cash')) {
      throw AppError.forbidden('Your role may not use the cash register');
    }
  }

  private duplicate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return AppError.conflict('REGISTER_EXISTS', 'A register with this name already exists');
    }
    return error;
  }
}

function emptyFigures(): Figures {
  return { salesCount: 0, salesTotal: dec(0), cashSales: dec(0), cashIn: dec(0), cashOut: dec(0) };
}

