import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec } from '@mizmar/core';
import type { bankSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut, toPrismaDecimal } from '../common/util/decimal';
import { CsvError } from '../imports/csv';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { parseBankStatement } from './bank-csv';
import { autoPick, rankCandidates, type MatchCandidate, type MatchLine } from './match';

type Account = z.infer<typeof bankSchemas.bankAccount>;
type AccountBody = z.infer<typeof bankSchemas.bankAccountBody>;
type Line = z.infer<typeof bankSchemas.bankLine>;
type ImportResult = z.infer<typeof bankSchemas.bankImportResult>;
type Candidate = z.infer<typeof bankSchemas.bankCandidate>;
type MatchBody = z.infer<typeof bankSchemas.bankMatchBody>;

const iso = (date: Date) => date.toISOString().slice(0, 10);

const lineInclude = {
  payment: {
    select: {
      id: true,
      amount: true,
      direction: true,
      paidAt: true,
      dueDate: true,
      reference: true,
      contact: { select: { displayName: true } },
    },
  },
  expensePayment: {
    select: {
      id: true,
      amount: true,
      paidAt: true,
      reference: true,
      expense: { select: { description: true, reference: true, supplier: { select: { displayName: true } } } },
    },
  },
} satisfies Prisma.BankStatementLineInclude;

type LineRow = Prisma.BankStatementLineGetPayload<{ include: typeof lineInclude }>;

@Injectable()
export class BankService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- accounts ----------------------------------------------------------

  async listAccounts(ctx: RequestContext): Promise<Account[]> {
    this.assertCan(ctx, 'read');
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId: ctx.companyId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return Promise.all(accounts.map((account) => this.withStats(account)));
  }

  async createAccount(ctx: RequestContext, body: AccountBody): Promise<Account> {
    this.assertCan(ctx, 'update');
    const row = await this.prisma.bankAccount.create({
      data: {
        companyId: ctx.companyId,
        name: body.name,
        bankName: body.bankName || null,
        iban: body.iban || null,
        currency: body.currency,
        openingBalance: toPrismaDecimal(body.openingBalance),
        isActive: body.isActive,
      },
    });
    return this.withStats(row);
  }

  async updateAccount(ctx: RequestContext, id: string, body: Partial<AccountBody>): Promise<Account> {
    this.assertCan(ctx, 'update');
    await this.accountOrThrow(ctx, id);
    const row = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.bankName !== undefined ? { bankName: body.bankName || null } : {}),
        ...(body.iban !== undefined ? { iban: body.iban || null } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.openingBalance !== undefined ? { openingBalance: toPrismaDecimal(body.openingBalance) } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    return this.withStats(row);
  }

  // ----- statement lines ---------------------------------------------------

  async listLines(
    ctx: RequestContext,
    accountId: string,
    query: { status?: z.infer<typeof bankSchemas.bankLineStatusEnum>; search?: string },
  ): Promise<Line[]> {
    this.assertCan(ctx, 'read');
    await this.accountOrThrow(ctx, accountId);
    const rows = await this.prisma.bankStatementLine.findMany({
      where: {
        bankAccountId: accountId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { description: { contains: query.search, mode: 'insensitive' } },
                { reference: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
      include: lineInclude,
    });
    return rows.map(mapLine);
  }

  async importStatement(ctx: RequestContext, accountId: string, csv: string): Promise<ImportResult> {
    this.assertCan(ctx, 'update');
    await this.accountOrThrow(ctx, accountId);

    let parsed;
    try {
      parsed = parseBankStatement(csv);
    } catch (cause) {
      if (cause instanceof CsvError) throw AppError.badRequest('INVALID_STATEMENT', cause.message);
      throw cause;
    }

    // Identical rows in one file (two same-day fees) get distinct fingerprints
    // by occurrence, so re-importing the same file stays a no-op.
    const seen = new Map<string, number>();
    const rows = parsed.lines.map((line) => {
      const n = (seen.get(line.fingerprint) ?? 0) + 1;
      seen.set(line.fingerprint, n);
      return { ...line, fingerprint: `${line.fingerprint}:${n}` };
    });

    const created = await this.prisma.bankStatementLine.createMany({
      data: rows.map((line) => ({
        bankAccountId: accountId,
        date: new Date(line.date),
        description: line.description,
        reference: line.reference,
        amount: toPrismaDecimal(line.amount),
        balance: line.balance === null ? null : toPrismaDecimal(line.balance),
        fingerprint: line.fingerprint,
      })),
      skipDuplicates: true,
    });

    const autoMatched = await this.autoMatchAccount(ctx, accountId);
    return {
      imported: created.count,
      duplicates: rows.length - created.count,
      skipped: parsed.skipped,
      autoMatched,
    };
  }

  // ----- matching ----------------------------------------------------------

  async autoMatch(ctx: RequestContext, accountId: string): Promise<{ matched: number }> {
    this.assertCan(ctx, 'update');
    await this.accountOrThrow(ctx, accountId);
    return { matched: await this.autoMatchAccount(ctx, accountId) };
  }

  async candidates(ctx: RequestContext, lineId: string): Promise<Candidate[]> {
    this.assertCan(ctx, 'read');
    const line = await this.lineOrThrow(ctx, lineId);
    const pool = await this.pool(ctx);
    return rankCandidates(toMatchLine(line), pool)
      .slice(0, 10)
      .map(({ candidate, score }) => ({ ...toRef(candidate), score }));
  }

  async match(ctx: RequestContext, lineId: string, body: MatchBody): Promise<Line> {
    this.assertCan(ctx, 'update');
    const line = await this.lineOrThrow(ctx, lineId);
    if (line.status === 'MATCHED') {
      throw AppError.unprocessable('ALREADY_MATCHED', 'This statement line is already matched');
    }
    const candidate = (await this.pool(ctx)).find((c) => c.kind === body.kind && c.id === body.id);
    if (!candidate) {
      throw AppError.unprocessable('NOT_AVAILABLE', 'That payment is missing or already matched');
    }
    if (!dec(candidate.amount).eq(dec(line.amount.toFixed()))) {
      throw AppError.unprocessable('AMOUNT_MISMATCH', 'The amounts differ; only equal amounts can be matched');
    }
    await this.prisma.$transaction((tx) => this.applyMatch(tx, ctx, line.id, line.date, candidate));
    return this.reload(lineId);
  }

  async unmatch(ctx: RequestContext, lineId: string): Promise<Line> {
    this.assertCan(ctx, 'update');
    await this.lineOrThrow(ctx, lineId);
    await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: 'UNMATCHED', paymentId: null, expensePaymentId: null, matchedAt: null, matchedById: null },
    });
    return this.reload(lineId);
  }

  async ignore(ctx: RequestContext, lineId: string, ignored: boolean): Promise<Line> {
    this.assertCan(ctx, 'update');
    const line = await this.lineOrThrow(ctx, lineId);
    if (line.status === 'MATCHED') {
      throw AppError.unprocessable('ALREADY_MATCHED', 'Unmatch the line before ignoring it');
    }
    await this.prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { status: ignored ? 'IGNORED' : 'UNMATCHED' },
    });
    return this.reload(lineId);
  }

  // ----- internals ---------------------------------------------------------

  private async autoMatchAccount(ctx: RequestContext, accountId: string): Promise<number> {
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { bankAccountId: accountId, status: 'UNMATCHED' },
      orderBy: { date: 'asc' },
      include: lineInclude,
    });
    if (lines.length === 0) return 0;

    let pool = await this.pool(ctx);
    let matched = 0;
    for (const line of lines) {
      const pick = autoPick(toMatchLine(line), pool);
      if (!pick) continue;
      await this.prisma.$transaction((tx) => this.applyMatch(tx, ctx, line.id, line.date, pick));
      pool = pool.filter((candidate) => !(candidate.kind === pick.kind && candidate.id === pick.id));
      matched += 1;
    }
    return matched;
  }

  /** Link the line, and let a bank-confirmed cheque count as cashed. */
  private async applyMatch(
    tx: Prisma.TransactionClient,
    ctx: RequestContext,
    lineId: string,
    bankDate: Date,
    candidate: MatchCandidate,
  ): Promise<void> {
    await tx.bankStatementLine.update({
      where: { id: lineId },
      data: {
        status: 'MATCHED',
        matchedAt: new Date(),
        matchedById: ctx.userId,
        paymentId: candidate.kind === 'PAYMENT' ? candidate.id : null,
        expensePaymentId: candidate.kind === 'EXPENSE_PAYMENT' ? candidate.id : null,
      },
    });

    if (candidate.kind !== 'PAYMENT') return;
    const payment = await tx.payment.findUnique({ where: { id: candidate.id }, select: { status: true } });
    if (payment && (payment.status === 'PENDING' || payment.status === 'DEPOSITED')) {
      await tx.payment.update({ where: { id: candidate.id }, data: { status: 'CLEARED', clearedAt: bankDate } });
      await tx.paymentStatusEvent.create({
        data: {
          paymentId: candidate.id,
          status: 'CLEARED',
          at: bankDate,
          note: 'Bank reconciliation',
          userId: ctx.userId,
        },
      });
    }
  }

  /** Bank-moving payments of this company that no statement line claims yet. */
  private async pool(ctx: RequestContext): Promise<MatchCandidate[]> {
    const [payments, expensePayments] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          companyId: ctx.companyId,
          bankLine: null,
          cashSessionId: null,
          method: { not: 'CASH' },
          status: { in: ['PENDING', 'DEPOSITED', 'CLEARED'] },
        },
        select: {
          id: true,
          amount: true,
          direction: true,
          paidAt: true,
          dueDate: true,
          reference: true,
          contact: { select: { displayName: true } },
        },
        orderBy: { paidAt: 'desc' },
        take: 3000,
      }),
      this.prisma.expensePayment.findMany({
        where: { bankLine: null, method: { not: 'CASH' }, expense: { companyId: ctx.companyId } },
        select: {
          id: true,
          amount: true,
          paidAt: true,
          reference: true,
          expense: { select: { description: true, reference: true, supplier: { select: { displayName: true } } } },
        },
        orderBy: { paidAt: 'desc' },
        take: 3000,
      }),
    ]);

    return [
      ...payments.map((row): MatchCandidate => ({
        kind: 'PAYMENT',
        id: row.id,
        amount: signed(row.amount, row.direction === 'INBOUND'),
        paidAt: iso(row.paidAt),
        dueDate: row.dueDate ? iso(row.dueDate) : null,
        reference: row.reference,
        label: row.contact.displayName,
      })),
      ...expensePayments.map((row): MatchCandidate => ({
        kind: 'EXPENSE_PAYMENT',
        id: row.id,
        amount: signed(row.amount, false),
        paidAt: iso(row.paidAt),
        dueDate: null,
        reference: row.reference,
        label: row.expense.supplier?.displayName ?? row.expense.description ?? row.expense.reference ?? '',
      })),
    ];
  }

  private async withStats(account: Prisma.BankAccountGetPayload<object>): Promise<Account> {
    const [all, unmatched, last] = await Promise.all([
      this.prisma.bankStatementLine.aggregate({
        where: { bankAccountId: account.id },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.bankStatementLine.aggregate({
        where: { bankAccountId: account.id, status: 'UNMATCHED' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.bankStatementLine.findFirst({
        where: { bankAccountId: account.id },
        orderBy: { date: 'desc' },
        select: { date: true },
      }),
    ]);
    return {
      id: account.id,
      name: account.name,
      bankName: account.bankName,
      iban: account.iban,
      currency: account.currency,
      openingBalance: moneyOut(account.openingBalance),
      isActive: account.isActive,
      statementBalance: moneyOut(dec(account.openingBalance.toFixed()).plus(dec((all._sum.amount ?? 0).toString()))),
      lineCount: all._count,
      unmatchedCount: unmatched._count,
      unmatchedTotal: moneyOut(dec((unmatched._sum.amount ?? 0).toString())),
      lastLineDate: last ? iso(last.date) : null,
    };
  }

  private async reload(id: string): Promise<Line> {
    const row = await this.prisma.bankStatementLine.findUniqueOrThrow({ where: { id }, include: lineInclude });
    return mapLine(row);
  }

  private async accountOrThrow(ctx: RequestContext, id: string) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!account) throw AppError.notFound('Bank account', id);
    return account;
  }

  private async lineOrThrow(ctx: RequestContext, id: string) {
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id, bankAccount: { companyId: ctx.companyId } },
      include: lineInclude,
    });
    if (!line) throw AppError.notFound('Statement line', id);
    return line;
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'update'): void {
    if (!ctx.ability.can(action, 'Payment')) {
      throw AppError.forbidden('Your role may not manage bank reconciliation');
    }
  }
}

function signed(amount: Prisma.Decimal, inbound: boolean): string {
  const value = dec(amount.toFixed()).abs();
  return (inbound ? value : value.neg()).toFixed(2);
}

function toMatchLine(line: LineRow): MatchLine {
  return {
    date: iso(line.date),
    amount: line.amount.toFixed(2),
    description: line.description,
    reference: line.reference,
  };
}

function toRef(candidate: MatchCandidate): z.infer<typeof bankSchemas.bankMatchRef> {
  return {
    kind: candidate.kind,
    id: candidate.id,
    label: candidate.label,
    reference: candidate.reference,
    amount: candidate.amount,
    paidAt: candidate.paidAt,
    dueDate: candidate.dueDate,
  };
}

function mapLine(row: LineRow): Line {
  let match: Line['match'] = null;
  if (row.payment) {
    match = toRef({
      kind: 'PAYMENT',
      id: row.payment.id,
      amount: signed(row.payment.amount, row.payment.direction === 'INBOUND'),
      paidAt: iso(row.payment.paidAt),
      dueDate: row.payment.dueDate ? iso(row.payment.dueDate) : null,
      reference: row.payment.reference,
      label: row.payment.contact.displayName,
    });
  } else if (row.expensePayment) {
    match = toRef({
      kind: 'EXPENSE_PAYMENT',
      id: row.expensePayment.id,
      amount: signed(row.expensePayment.amount, false),
      paidAt: iso(row.expensePayment.paidAt),
      dueDate: null,
      reference: row.expensePayment.reference,
      label:
        row.expensePayment.expense.supplier?.displayName ??
        row.expensePayment.expense.description ??
        row.expensePayment.expense.reference ??
        '',
    });
  }
  return {
    id: row.id,
    date: iso(row.date),
    description: row.description,
    reference: row.reference,
    amount: moneyOut(row.amount),
    balance: row.balance === null ? null : moneyOut(row.balance),
    status: row.status,
    match,
  };
}
