import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec } from '@mizmar/core';
import type { accountingSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut, toPrismaDecimal } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { DEFAULT_CHART } from './chart';
import {
  documentDraft,
  expenseDraft,
  expensePaymentDraft,
  fingerprint,
  openingDraft,
  paymentDrafts,
  type Draft,
  type DraftLine,
} from './posting';

type Account = z.infer<typeof accountingSchemas.account>;
type AccountBody = z.infer<typeof accountingSchemas.accountBody>;
type Entry = z.infer<typeof accountingSchemas.journalEntry>;
type EntryBody = z.infer<typeof accountingSchemas.entryBody>;
type Ledger = z.infer<typeof accountingSchemas.ledgerResponse>;
type Trial = z.infer<typeof accountingSchemas.trialBalanceResponse>;

const iso = (date: Date) => date.toISOString().slice(0, 10);
const today = () => iso(new Date());
const num = (value: Prisma.Decimal | string | number | null | undefined) => dec((value ?? 0).toString());

/** `base`, `base~2`, ... — successive postings of the same source object. */
const versionKey = (base: string, version: number) => (version === 1 ? base : `${base}~${version}`);

function parseKey(key: string): { base: string; version: number; reversal: boolean } {
  const reversal = key.endsWith(':rev');
  const core = reversal ? key.slice(0, -4) : key;
  const match = /^(.*)~(\d+)$/.exec(core);
  return match
    ? { base: match[1]!, version: Number(match[2]), reversal }
    : { base: core, version: 1, reversal };
}

const entryInclude = {
  lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { id: 'asc' } },
} satisfies Prisma.JournalEntryInclude;

type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof entryInclude }>;

@Injectable()
export class AccountingService {
  /** Recent syncs per company, so opening several reports in a row posts once. */
  private readonly lastSync = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  // ----- chart -------------------------------------------------------------

  async listAccounts(ctx: RequestContext): Promise<Account[]> {
    this.assertCan(ctx, 'read');
    await this.ensureChart(ctx.companyId);
    await this.autoSync(ctx);

    const [accounts, sums] = await Promise.all([
      this.prisma.account.findMany({ where: { companyId: ctx.companyId }, orderBy: { code: 'asc' } }),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: { entry: { companyId: ctx.companyId } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const byAccount = new Map(sums.map((row) => [row.accountId, row._sum]));
    return accounts.map((row) => {
      const sum = byAccount.get(row.id);
      return mapAccount(row, num(sum?.debit), num(sum?.credit));
    });
  }

  async createAccount(ctx: RequestContext, body: AccountBody): Promise<Account> {
    this.assertCan(ctx, 'update');
    await this.ensureChart(ctx.companyId);
    try {
      const row = await this.prisma.account.create({ data: { companyId: ctx.companyId, ...body } });
      return mapAccount(row, dec(0), dec(0));
    } catch (cause) {
      throw duplicateCode(cause);
    }
  }

  async updateAccount(ctx: RequestContext, id: string, body: Partial<AccountBody>): Promise<Account> {
    this.assertCan(ctx, 'update');
    const account = await this.prisma.account.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!account) throw AppError.notFound('Account', id);
    if (body.type && body.type !== account.type) {
      const used = await this.prisma.journalLine.count({ where: { accountId: id } });
      if (used > 0) {
        throw AppError.unprocessable('ACCOUNT_IN_USE', 'An account with entries cannot change type');
      }
    }
    try {
      const row = await this.prisma.account.update({ where: { id }, data: body });
      const sum = await this.prisma.journalLine.aggregate({ where: { accountId: id }, _sum: { debit: true, credit: true } });
      return mapAccount(row, num(sum._sum.debit), num(sum._sum.credit));
    } catch (cause) {
      throw duplicateCode(cause);
    }
  }

  // ----- journal -----------------------------------------------------------

  async listEntries(
    ctx: RequestContext,
    query: z.infer<typeof accountingSchemas.entriesQuery>,
  ): Promise<Entry[]> {
    this.assertCan(ctx, 'read');
    await this.ensureChart(ctx.companyId);
    await this.autoSync(ctx);

    const rows = await this.prisma.journalEntry.findMany({
      where: {
        companyId: ctx.companyId,
        ...(query.source ? { source: query.source } : {}),
        ...(query.from || query.to
          ? { date: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
          : {}),
        ...(query.search
          ? {
              OR: [
                { label: { contains: query.search, mode: 'insensitive' } },
                { lines: { some: { account: { code: { startsWith: query.search } } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ date: 'desc' }, { seq: 'desc' }],
      take: query.limit,
      include: entryInclude,
    });
    return rows.map(mapEntry);
  }

  async createEntry(ctx: RequestContext, body: EntryBody): Promise<Entry> {
    this.assertCan(ctx, 'update');
    await this.ensureChart(ctx.companyId);

    const debit = body.lines.reduce((sum, line) => sum.plus(line.debit), dec(0));
    const credit = body.lines.reduce((sum, line) => sum.plus(line.credit), dec(0));
    if (!debit.eq(credit) || debit.lte(0)) {
      throw AppError.unprocessable('UNBALANCED_ENTRY', 'Debits and credits must be equal and above zero', {
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
      });
    }
    for (const line of body.lines) {
      if (dec(line.debit).gt(0) && dec(line.credit).gt(0)) {
        throw AppError.badRequest('LINE_BOTH_SIDES', 'A line is either a debit or a credit');
      }
    }
    const ids = [...new Set(body.lines.map((line) => line.accountId))];
    const found = await this.prisma.account.count({ where: { id: { in: ids }, companyId: ctx.companyId } });
    if (found !== ids.length) throw AppError.notFound('Account');

    const id = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, ctx.companyId);
      const entry = await tx.journalEntry.create({
        data: {
          companyId: ctx.companyId,
          seq: await this.nextSeq(tx, ctx.companyId),
          date: new Date(body.date),
          label: body.label,
          source: 'MANUAL',
          createdById: ctx.userId,
          lines: {
            create: body.lines.map((line) => ({
              accountId: line.accountId,
              debit: toPrismaDecimal(line.debit),
              credit: toPrismaDecimal(line.credit),
              label: line.label ?? null,
            })),
          },
        },
      });
      return entry.id;
    });
    return mapEntry(await this.prisma.journalEntry.findUniqueOrThrow({ where: { id }, include: entryInclude }));
  }

  async deleteEntry(ctx: RequestContext, id: string): Promise<void> {
    this.assertCan(ctx, 'update');
    const entry = await this.prisma.journalEntry.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!entry) throw AppError.notFound('Journal entry', id);
    if (entry.source !== 'MANUAL') {
      throw AppError.unprocessable(
        'AUTOMATIC_ENTRY',
        'Automatic entries follow their document or payment; change the source instead',
      );
    }
    await this.prisma.journalEntry.delete({ where: { id } });
  }

  // ----- reports -----------------------------------------------------------

  async ledger(ctx: RequestContext, query: z.infer<typeof accountingSchemas.ledgerQuery>): Promise<Ledger> {
    this.assertCan(ctx, 'read');
    await this.autoSync(ctx);
    const account = await this.prisma.account.findFirst({ where: { id: query.accountId, companyId: ctx.companyId } });
    if (!account) throw AppError.notFound('Account', query.accountId);

    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    const [before, rows] = await Promise.all([
      from
        ? this.prisma.journalLine.aggregate({
            where: { accountId: account.id, entry: { date: { lt: from } } },
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve(null),
      this.prisma.journalLine.findMany({
        where: {
          accountId: account.id,
          entry: { companyId: ctx.companyId, date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
        },
        include: { entry: { select: { id: true, seq: true, date: true, label: true } } },
        orderBy: [{ entry: { date: 'asc' } }, { entry: { seq: 'asc' } }],
        take: 5000,
      }),
    ]);

    const opening = before ? num(before._sum.debit).minus(num(before._sum.credit)) : dec(0);
    let running = opening;
    let debit = dec(0);
    let credit = dec(0);
    const lines = rows.map((row) => {
      running = running.plus(num(row.debit)).minus(num(row.credit));
      debit = debit.plus(num(row.debit));
      credit = credit.plus(num(row.credit));
      return {
        date: iso(row.entry.date),
        entryId: row.entry.id,
        seq: row.entry.seq,
        label: row.label ?? row.entry.label,
        debit: moneyOut(row.debit),
        credit: moneyOut(row.credit),
        balance: moneyOut(running),
      };
    });

    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type },
      opening: moneyOut(opening),
      lines,
      debit: moneyOut(debit),
      credit: moneyOut(credit),
      closing: moneyOut(running),
    };
  }

  async trialBalance(ctx: RequestContext, query: z.infer<typeof accountingSchemas.periodQuery>): Promise<Trial> {
    this.assertCan(ctx, 'read');
    await this.ensureChart(ctx.companyId);
    await this.autoSync(ctx);

    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    const [accounts, opening, period] = await Promise.all([
      this.prisma.account.findMany({ where: { companyId: ctx.companyId }, orderBy: { code: 'asc' } }),
      from
        ? this.prisma.journalLine.groupBy({
            by: ['accountId'],
            where: { entry: { companyId: ctx.companyId, date: { lt: from } } },
            _sum: { debit: true, credit: true },
          })
        : Promise.resolve([]),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          entry: { companyId: ctx.companyId, date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const openBy = new Map(opening.map((row) => [row.accountId, num(row._sum.debit).minus(num(row._sum.credit))]));
    const periodBy = new Map(period.map((row) => [row.accountId, row._sum]));

    let totalDebit = dec(0);
    let totalCredit = dec(0);
    let income = dec(0);
    let expense = dec(0);
    const rows: Trial['rows'] = [];

    for (const account of accounts) {
      const open = openBy.get(account.id) ?? dec(0);
      const sum = periodBy.get(account.id);
      const debit = num(sum?.debit);
      const credit = num(sum?.credit);
      if (open.isZero() && debit.isZero() && credit.isZero()) continue;

      const closing = open.plus(debit).minus(credit);
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      // Result over the period only: opening balances belong to earlier periods.
      if (account.type === 'INCOME') income = income.plus(credit.minus(debit));
      if (account.type === 'EXPENSE') expense = expense.plus(debit.minus(credit));

      rows.push({
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        opening: moneyOut(open),
        debit: moneyOut(debit),
        credit: moneyOut(credit),
        closing: moneyOut(closing),
      });
    }

    return {
      rows,
      totals: { debit: moneyOut(totalDebit), credit: moneyOut(totalCredit) },
      result: { income: moneyOut(income), expense: moneyOut(expense), net: moneyOut(income.minus(expense)) },
      balanced: totalDebit.eq(totalCredit),
    };
  }

  // ----- automatic posting -------------------------------------------------

  async sync(ctx: RequestContext): Promise<{ posted: number; reversed: number }> {
    this.assertCan(ctx, 'update');
    await this.ensureChart(ctx.companyId);
    return this.runSync(ctx.companyId, ctx.userId);
  }

  /** Reads keep the books current without the user pressing a button. */
  private async autoSync(ctx: RequestContext): Promise<void> {
    const last = this.lastSync.get(ctx.companyId) ?? 0;
    if (Date.now() - last < 1500) return;
    this.lastSync.set(ctx.companyId, Date.now());
    try {
      await this.runSync(ctx.companyId, null);
    } catch {
      // Reporting should still work if a posting fails; the explicit sync shows the error.
      this.lastSync.delete(ctx.companyId);
    }
  }

  private async runSync(companyId: string, userId: string | null): Promise<{ posted: number; reversed: number }> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { defaultCurrency: true },
    });

    const desired = await this.collectDrafts(companyId, company.defaultCurrency);

    if ([...desired.values()].some((draft) => draft.source === 'OPENING')) {
      await this.ensureOpeningAccount(companyId);
    }
    const accounts = await this.prisma.account.findMany({ where: { companyId, role: { not: null } } });
    const accountByRole = new Map(accounts.map((account) => [account.role!, account]));

    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, companyId);

        const existing = await tx.journalEntry.findMany({
          where: { companyId, source: { not: 'MANUAL' }, sourceKey: { not: null } },
          select: { id: true, sourceKey: true, fingerprint: true, date: true, label: true, source: true },
        });

        // Per base: the newest version and whether it has been reversed.
        const state = new Map<string, { latest: number; key: string; reversed: boolean; fingerprint: string | null; entry: (typeof existing)[number] }>();
        const reversedKeys = new Set(existing.filter((e) => parseKey(e.sourceKey!).reversal).map((e) => e.sourceKey!));
        for (const entry of existing) {
          const parsed = parseKey(entry.sourceKey!);
          if (parsed.reversal) continue;
          const current = state.get(parsed.base);
          if (!current || parsed.version > current.latest) {
            state.set(parsed.base, {
              latest: parsed.version,
              key: entry.sourceKey!,
              reversed: reversedKeys.has(`${entry.sourceKey}:rev`),
              fingerprint: entry.fingerprint,
              entry,
            });
          }
        }

        let seq = await this.nextSeq(tx, companyId);
        let posted = 0;
        let reversed = 0;

        const reverse = async (key: string) => {
          const original = await tx.journalEntry.findFirstOrThrow({
            where: { companyId, sourceKey: key },
            include: { lines: true },
          });
          await tx.journalEntry.create({
            data: {
              companyId,
              seq: seq++,
              date: new Date(today()),
              label: `Annulation — ${original.label}`,
              source: original.source,
              sourceKey: `${key}:rev`,
              createdById: userId,
              lines: {
                create: original.lines.map((line) => ({
                  accountId: line.accountId,
                  debit: line.credit,
                  credit: line.debit,
                  label: line.label,
                })),
              },
            },
          });
          reversed += 1;
        };

        const post = async (draft: Draft, version: number) => {
          const resolved = draft.lines.map((line) => {
            const account = accountByRole.get(line.role);
            if (!account) throw AppError.unprocessable('MISSING_ACCOUNT', `No account is set up for ${line.role}`);
            return { account, line };
          });
          await tx.journalEntry.create({
            data: {
              companyId,
              seq: seq++,
              date: new Date(draft.date),
              label: draft.label,
              source: draft.source,
              sourceKey: versionKey(draft.base, version),
              fingerprint: fingerprintOf(draft, accountByRole),
              createdById: userId,
              lines: {
                create: resolved.map(({ account, line }) => ({
                  accountId: account.id,
                  debit: toPrismaDecimal(line.debit),
                  credit: toPrismaDecimal(line.credit),
                  label: line.label ?? null,
                })),
              },
            },
          });
          posted += 1;
        };

        for (const [base, draft] of desired) {
          const current = state.get(base);
          if (!current) {
            await post(draft, 1);
          } else if (current.reversed) {
            await post(draft, current.latest + 1);
          } else if (current.fingerprint !== fingerprintOf(draft, accountByRole)) {
            // The source was edited after posting: undo the old figures, post the new.
            await reverse(current.key);
            await post(draft, current.latest + 1);
          }
        }

        // Sources that no longer post anything (cancelled, bounced, deleted).
        for (const [base, current] of state) {
          if (!desired.has(base) && !current.reversed) await reverse(current.key);
        }

        return { posted, reversed };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    this.lastSync.set(companyId, Date.now());
    return result;
  }

  /** What the books should say right now, keyed by posting base. */
  private async collectDrafts(companyId: string, currency: string): Promise<Map<string, Draft>> {
    const [documents, payments, expenses, expensePayments, openings] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          companyId,
          type: { in: ['SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_INVOICE'] },
          lifecycle: { in: ['VALIDATED', 'SENT'] },
        },
        select: {
          id: true,
          type: true,
          number: true,
          issueDate: true,
          currency: true,
          exchangeRate: true,
          totalExclVat: true,
          totalVat: true,
          totalInclVat: true,
          contact: { select: { displayName: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { companyId },
        select: {
          id: true,
          direction: true,
          method: true,
          status: true,
          amount: true,
          currency: true,
          exchangeRate: true,
          paidAt: true,
          clearedAt: true,
          reference: true,
          methodConfig: { select: { deferred: true } },
          contact: { select: { displayName: true } },
        },
      }),
      this.prisma.expense.findMany({
        where: { companyId, status: { in: ['UNPAID', 'PARTIAL', 'PAID'] } },
        select: {
          id: true,
          reference: true,
          description: true,
          issueDate: true,
          amountExclVat: true,
          vatAmount: true,
          totalInclVat: true,
          category: { select: { kind: true, name: true } },
          supplier: { select: { displayName: true } },
        },
      }),
      this.prisma.expensePayment.findMany({
        where: { expense: { companyId, status: { in: ['UNPAID', 'PARTIAL', 'PAID'] } } },
        select: {
          id: true,
          method: true,
          amount: true,
          paidAt: true,
          expense: { select: { reference: true, description: true, category: { select: { name: true } }, supplier: { select: { displayName: true } } } },
        },
      }),
      this.prisma.contactOpeningBalance.findMany({
        where: { companyId },
        select: { id: true, amount: true, asOf: true, contact: { select: { displayName: true, kind: true } } },
      }),
    ]);

    const drafts = new Map<string, Draft>();
    const add = (draft: Draft | null) => draft && drafts.set(draft.base, draft);
    // Foreign-currency amounts are booked at the document's own rate.
    const rate = (cur: string, exchange: Prisma.Decimal) => (cur === currency ? dec(1) : num(exchange));
    const conv = (value: Prisma.Decimal, factor: ReturnType<typeof dec>) => num(value).times(factor).toFixed(2);

    for (const row of documents) {
      const factor = rate(row.currency, row.exchangeRate);
      add(
        documentDraft({
          id: row.id,
          type: row.type as 'SALES_INVOICE' | 'CREDIT_NOTE' | 'PURCHASE_INVOICE',
          number: row.number,
          contactName: row.contact.displayName,
          date: iso(row.issueDate),
          exclVat: conv(row.totalExclVat, factor),
          vat: conv(row.totalVat, factor),
          inclVat: conv(row.totalInclVat, factor),
        }),
      );
    }

    for (const row of payments) {
      const factor = rate(row.currency, row.exchangeRate);
      for (const draft of paymentDrafts({
        id: row.id,
        direction: row.direction,
        deferred: row.methodConfig?.deferred ?? (row.method === 'CHEQUE' || row.method === 'BILL_OF_EXCHANGE'),
        status: row.status,
        cashMethod: row.method === 'CASH',
        amount: conv(row.amount, factor),
        paidAt: iso(row.paidAt),
        clearedAt: row.clearedAt ? iso(row.clearedAt) : null,
        contactName: row.contact.displayName,
        reference: row.reference,
      })) {
        add(draft);
      }
    }

    for (const row of expenses) {
      add(
        expenseDraft({
          id: row.id,
          categoryKind: row.category.kind,
          label: `${row.description ?? row.category.name}${row.supplier ? ` — ${row.supplier.displayName}` : ''}`,
          date: iso(row.issueDate),
          exclVat: num(row.amountExclVat).toFixed(2),
          vat: num(row.vatAmount).toFixed(2),
          inclVat: num(row.totalInclVat).toFixed(2),
        }),
      );
    }

    for (const row of openings) {
      add(
        openingDraft({
          id: row.id,
          supplier: row.contact.kind === 'SUPPLIER',
          contactName: row.contact.displayName,
          date: iso(row.asOf),
          amount: num(row.amount).toFixed(2),
        }),
      );
    }

    for (const row of expensePayments) {
      add(
        expensePaymentDraft({
          id: row.id,
          label: row.expense.description ?? row.expense.category.name,
          date: iso(row.paidAt),
          amount: num(row.amount).toFixed(2),
          cashMethod: row.method === 'CASH',
        }),
      );
    }

    return drafts;
  }

  // ----- helpers -----------------------------------------------------------

  /** Charts made before opening balances existed have no counter-account for them. */
  private async ensureOpeningAccount(companyId: string): Promise<void> {
    const has = await this.prisma.account.count({ where: { companyId, role: 'OPENING' } });
    if (has > 0) return;
    const carried = await this.prisma.account.findFirst({ where: { companyId, code: '1191', role: null } });
    if (carried) {
      await this.prisma.account.update({ where: { id: carried.id }, data: { role: 'OPENING' } });
    } else {
      await this.prisma.account.create({
        data: { companyId, code: '1191', name: 'Report à nouveau', type: 'EQUITY', role: 'OPENING' },
      });
    }
  }

  /** First use of a company: create its chart. Existing charts are left alone. */
  private async ensureChart(companyId: string): Promise<void> {
    const count = await this.prisma.account.count({ where: { companyId } });
    if (count > 0) return;
    await this.prisma.account.createMany({
      data: DEFAULT_CHART.map((account) => ({ companyId, ...account })),
      skipDuplicates: true,
    });
  }

  /** Serialise journal writes per company so sequence numbers never collide. */
  private async lock(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'journal:' + companyId}))`;
  }

  private async nextSeq(tx: Prisma.TransactionClient, companyId: string): Promise<number> {
    const last = await tx.journalEntry.aggregate({ where: { companyId }, _max: { seq: true } });
    return (last._max.seq ?? 0) + 1;
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'update'): void {
    if (!ctx.ability.can(action, 'Payment')) throw AppError.forbidden('Your role may not use accounting');
  }
}

function fingerprintOf(draft: Draft, accountByRole: Map<string, { code: string }>): string {
  return fingerprint(
    draft.date,
    draft.lines.map((line: DraftLine) => ({
      code: accountByRole.get(line.role)?.code ?? line.role,
      debit: line.debit,
      credit: line.credit,
    })),
  );
}

function duplicateCode(cause: unknown): unknown {
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
    return AppError.conflict('DUPLICATE_ACCOUNT', 'An account with this code already exists');
  }
  return cause;
}

function mapAccount(
  row: { id: string; code: string; name: string; type: Account['type']; role: string | null; isActive: boolean },
  debit: ReturnType<typeof dec>,
  credit: ReturnType<typeof dec>,
): Account {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    role: row.role,
    isActive: row.isActive,
    debit: moneyOut(debit),
    credit: moneyOut(credit),
    balance: moneyOut(debit.minus(credit)),
  };
}

function mapEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    seq: row.seq,
    date: iso(row.date),
    label: row.label,
    source: row.source,
    lines: row.lines.map((line) => ({
      accountId: line.accountId,
      code: line.account.code,
      name: line.account.name,
      debit: moneyOut(line.debit),
      credit: moneyOut(line.credit),
      label: line.label,
    })),
  };
}

