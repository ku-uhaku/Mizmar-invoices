import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computePayslip,
  dec,
  DEFAULT_PAYROLL_RULES,
  localDate,
  type PayItem,
  type PayrollRules,
  type PayslipResult,
} from '@mizmar/core';
import { payrollSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut, toPrismaDecimal } from '../common/util/decimal';
import { settlementStatus } from '../expenses/expense-math';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { fromDate, toDate } from '../hr/hr.service';

type RunSummary = z.infer<typeof payrollSchemas.runSummary>;
type RunDetail = z.infer<typeof payrollSchemas.runDetail>;
type Payslip = z.infer<typeof payrollSchemas.payslip>;
type PayslipRow = z.infer<typeof payrollSchemas.payslipRow>;
type PayslipUpdate = z.infer<typeof payrollSchemas.payslipUpdate>;
type RulesResponse = z.infer<typeof payrollSchemas.payrollRulesResponse>;
type RulesSave = z.infer<typeof payrollSchemas.payrollRulesSave>;
type Advance = z.infer<typeof payrollSchemas.advance>;
type AdvanceCreate = z.infer<typeof payrollSchemas.advanceCreate>;
type RunPay = z.infer<typeof payrollSchemas.runPay>;
type Skipped = RunDetail['skipped'];

const pad = (n: number) => String(n).padStart(2, '0');
const monthBounds = (year: number, month: number) => {
  const start = `${year}-${pad(month)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${year}-${pad(month)}-${pad(last)}` };
};

/** Every Monday-to-Saturday date in [from, to], as "YYYY-MM-DD". */
function workDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (const day = toDate(from); fromDate(day) <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0) dates.push(fromDate(day));
  }
  return dates;
}

const payslipInclude = { employee: { select: { firstName: true, lastName: true, employeeNumber: true } } } satisfies Prisma.PayslipInclude;
type PayslipRecord = Prisma.PayslipGetPayload<{ include: typeof payslipInclude }>;

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Rules
  // =========================================================================

  async getRules(ctx: RequestContext): Promise<RulesResponse> {
    this.assertCan(ctx, 'read');
    const today = localDate(new Date());
    const row = await this.latestRuleSet(ctx.companyId, today);
    return row
      ? { rules: row.rules, effectiveFrom: fromDate(row.effectiveFrom), source: 'custom' }
      : { rules: DEFAULT_PAYROLL_RULES, effectiveFrom: null, source: 'default' };
  }

  async saveRules(ctx: RequestContext, body: RulesSave): Promise<RulesResponse> {
    this.assertCan(ctx, 'update');
    await this.prisma.payrollRuleSet.upsert({
      where: { companyId_effectiveFrom: { companyId: ctx.companyId, effectiveFrom: toDate(body.effectiveFrom) } },
      create: {
        companyId: ctx.companyId,
        effectiveFrom: toDate(body.effectiveFrom),
        rules: body.rules as Prisma.InputJsonValue,
        note: body.note ?? null,
        createdById: ctx.userId,
      },
      update: { rules: body.rules as Prisma.InputJsonValue, note: body.note ?? null },
    });
    return this.getRules(ctx);
  }

  // =========================================================================
  // Runs
  // =========================================================================

  async listRuns(ctx: RequestContext): Promise<RunSummary[]> {
    this.assertCan(ctx, 'read');
    const runs = await this.prisma.payrollRun.findMany({
      where: { companyId: ctx.companyId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { _count: { select: { payslips: true } } },
    });
    return runs.map((run) => mapRun(run, run._count.payslips));
  }

  async createRun(ctx: RequestContext, body: { year: number; month: number }): Promise<RunDetail> {
    this.assertCan(ctx, 'create');
    let runId: string;
    try {
      const run = await this.prisma.payrollRun.create({
        data: { companyId: ctx.companyId, year: body.year, month: body.month, createdById: ctx.userId },
      });
      runId = run.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict('RUN_EXISTS', 'A payroll run already exists for this month');
      }
      throw error;
    }
    const skipped = await this.fill(ctx, runId);
    return this.detail(ctx, runId, skipped);
  }

  async getRun(ctx: RequestContext, id: string): Promise<RunDetail> {
    this.assertCan(ctx, 'read');
    return this.detail(ctx, id, []);
  }

  /** Re-read contracts, leave, attendance and advances; manual items on each payslip are kept. */
  async recomputeRun(ctx: RequestContext, id: string): Promise<RunDetail> {
    this.assertCan(ctx, 'update');
    const run = await this.runOrThrow(ctx, id);
    this.assertDraft(run.status);
    const skipped = await this.fill(ctx, id);
    return this.detail(ctx, id, skipped);
  }

  async validateRun(ctx: RequestContext, id: string): Promise<RunDetail> {
    this.assertCan(ctx, 'update');
    const run = await this.runOrThrow(ctx, id);
    this.assertDraft(run.status);

    await this.prisma.$transaction(async (tx) => {
      const payslips = await tx.payslip.findMany({ where: { runId: id } });
      if (payslips.length === 0) {
        throw AppError.unprocessable('RUN_EMPTY', 'This run has no payslips to validate');
      }
      const { end } = monthBounds(run.year, run.month);
      for (const payslip of payslips) {
        const deducted = dec(payslip.advanceDeduction.toFixed());
        if (deducted.gt(0)) {
          await this.applyAdvances(tx, ctx.companyId, payslip.employeeId, end, deducted, 'repay');
        }
      }
      await tx.payrollRun.update({
        where: { id },
        data: { status: 'VALIDATED', validatedAt: new Date(), validatedById: ctx.userId },
      });
    });
    return this.detail(ctx, id, []);
  }

  /** Unlock a validated (not yet paid) run for corrections; advance repayments are reversed. */
  async reopenRun(ctx: RequestContext, id: string): Promise<RunDetail> {
    this.assertCan(ctx, 'update');
    const run = await this.runOrThrow(ctx, id);
    if (run.status !== 'VALIDATED') {
      throw AppError.unprocessable('RUN_NOT_VALIDATED', 'Only a validated run can be reopened');
    }
    await this.prisma.$transaction(async (tx) => {
      const payslips = await tx.payslip.findMany({ where: { runId: id } });
      for (const payslip of payslips) {
        const deducted = dec(payslip.advanceDeduction.toFixed());
        if (deducted.gt(0)) {
          await this.applyAdvances(tx, ctx.companyId, payslip.employeeId, '9999-12-31', deducted, 'reverse');
        }
      }
      await tx.payrollRun.update({
        where: { id },
        data: { status: 'DRAFT', validatedAt: null, validatedById: null },
      });
    });
    return this.detail(ctx, id, []);
  }

  /**
   * Record the month as paid. The salary cost enters the books as one expense for
   * the full employer cost, with the net salaries marked as paid: what stays open
   * on it is the CNSS, AMO and income tax still to be remitted.
   */
  async payRun(ctx: RequestContext, id: string, body: RunPay): Promise<RunDetail> {
    this.assertCan(ctx, 'update');
    const run = await this.runOrThrow(ctx, id);
    if (run.status !== 'VALIDATED') {
      throw AppError.unprocessable('RUN_NOT_VALIDATED', 'Validate the run before paying it');
    }
    if (run.expenseId) throw AppError.conflict('ALREADY_PAID', 'This run has already been paid');

    await this.prisma.$transaction(async (tx) => {
      const category = await this.salaryCategory(tx, ctx.organizationId);
      const cost = dec(run.totalEmployerCost.toFixed());
      const net = dec(run.totalNet.toFixed());
      const { end } = monthBounds(run.year, run.month);

      const expense = await tx.expense.create({
        data: {
          companyId: ctx.companyId,
          categoryId: category.id,
          reference: `PAIE-${run.year}-${pad(run.month)}`,
          description: `Salaires ${pad(run.month)}/${run.year}`,
          issueDate: toDate(end),
          dueDate: toDate(body.paidAt),
          periodStart: toDate(monthBounds(run.year, run.month).start),
          periodEnd: toDate(end),
          amountExclVat: toPrismaDecimal(cost),
          vatRate: toPrismaDecimal(0),
          vatAmount: toPrismaDecimal(0),
          totalInclVat: toPrismaDecimal(cost),
          paidAmount: toPrismaDecimal(net.gt(cost) ? cost : net),
          status: settlementStatus('UNPAID', cost.toFixed(2), net.toFixed(2)),
          createdById: ctx.userId,
        },
      });
      if (net.gt(0)) {
        await tx.expensePayment.create({
          data: {
            expenseId: expense.id,
            method: body.method,
            amount: toPrismaDecimal(net.gt(cost) ? cost : net),
            paidAt: toDate(body.paidAt),
            note: 'Salaires nets',
            createdById: ctx.userId,
          },
        });
      }
      await tx.payrollRun.update({
        where: { id },
        data: { status: 'PAID', paidAt: toDate(body.paidAt), expenseId: expense.id },
      });
    });
    return this.detail(ctx, id, []);
  }

  async removeRun(ctx: RequestContext, id: string): Promise<void> {
    this.assertCan(ctx, 'delete');
    const run = await this.runOrThrow(ctx, id);
    this.assertDraft(run.status);
    await this.prisma.payrollRun.delete({ where: { id } });
  }

  // =========================================================================
  // Payslips
  // =========================================================================

  async getPayslip(ctx: RequestContext, id: string): Promise<Payslip> {
    this.assertCan(ctx, 'read');
    const record = await this.payslipOrThrow(ctx, id);
    return this.mapPayslip(record);
  }

  async updatePayslip(ctx: RequestContext, id: string, body: PayslipUpdate): Promise<Payslip> {
    this.assertCan(ctx, 'update');
    const record = await this.payslipOrThrow(ctx, id);
    this.assertDraft(record.run.status);

    const rules = parseRules(record.rulesSnapshot);
    const result = computePayslip(rules, {
      baseSalary: record.baseSalary.toFixed(),
      hourly: record.hourly,
      weeklyHours: record.weeklyHours.toFixed(),
      proration: Number(record.proration.toFixed()),
      unpaidDays: body.unpaidDays ?? record.unpaidDays.toFixed(),
      overtimeMinutes: body.overtimeMinutes ?? record.overtimeMinutes,
      additions: body.additions ?? (record.additions as unknown as PayItem[]),
      deductions: body.deductions ?? (record.deductions as unknown as PayItem[]),
      advanceDeduction: record.advanceDeduction.toFixed(),
      dependents: record.dependents,
    });
    await this.prisma.payslip.update({
      where: { id },
      data: {
        unpaidDays: toPrismaDecimal(body.unpaidDays ?? record.unpaidDays.toFixed()),
        overtimeMinutes: body.overtimeMinutes ?? record.overtimeMinutes,
        additions: (body.additions ?? record.additions) as Prisma.InputJsonValue,
        deductions: (body.deductions ?? record.deductions) as Prisma.InputJsonValue,
        ...resultColumns(result),
      },
    });
    await this.refreshTotals(record.runId);
    return this.mapPayslip(await this.payslipOrThrow(ctx, id));
  }

  // =========================================================================
  // Advances
  // =========================================================================

  async listAdvances(ctx: RequestContext): Promise<Advance[]> {
    this.assertCan(ctx, 'read');
    const rows = await this.prisma.salaryAdvance.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { date: 'desc' },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return rows.map(mapAdvance);
  }

  async createAdvance(ctx: RequestContext, body: AdvanceCreate): Promise<Advance> {
    this.assertCan(ctx, 'create');
    const employee = await this.prisma.employee.findFirst({
      where: { id: body.employeeId, companyId: ctx.companyId, status: 'ACTIVE' },
    });
    if (!employee) throw AppError.notFound('Employee', body.employeeId);
    if (dec(body.monthlyRepayment).gt(dec(body.amount))) {
      throw AppError.badRequest('INVALID_REPAYMENT', 'The monthly repayment exceeds the advance');
    }
    const row = await this.prisma.salaryAdvance.create({
      data: {
        companyId: ctx.companyId,
        employeeId: employee.id,
        amount: toPrismaDecimal(body.amount),
        date: toDate(body.date),
        monthlyRepayment: toPrismaDecimal(body.monthlyRepayment),
        note: body.note ?? null,
        createdById: ctx.userId,
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return mapAdvance(row);
  }

  async removeAdvance(ctx: RequestContext, id: string): Promise<void> {
    this.assertCan(ctx, 'delete');
    const row = await this.prisma.salaryAdvance.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!row) throw AppError.notFound('Advance', id);
    if (dec(row.repaid.toFixed()).gt(0)) {
      throw AppError.unprocessable('ADVANCE_IN_USE', 'This advance has already been partly repaid');
    }
    await this.prisma.salaryAdvance.delete({ where: { id } });
  }

  // =========================================================================
  // Building payslips
  // =========================================================================

  /** Create missing payslips and recompute existing ones for the run's month. */
  private async fill(ctx: RequestContext, runId: string): Promise<Skipped> {
    const run = await this.runOrThrow(ctx, runId);
    const { start, end } = monthBounds(run.year, run.month);
    const rules = await this.rulesFor(ctx.companyId, end);
    const skipped: Skipped = [];

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId: ctx.companyId,
        hireDate: { lte: toDate(end) },
        OR: [{ terminationDate: null }, { terminationDate: { gte: toDate(start) } }],
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: { department: { select: { name: true } } },
    });
    const existing = new Map(
      (await this.prisma.payslip.findMany({ where: { runId } })).map((p) => [p.employeeId, p]),
    );

    for (const employee of employees) {
      const name = `${employee.firstName} ${employee.lastName}`;
      const contract = await this.prisma.employmentContract.findFirst({
        where: {
          employeeId: employee.id,
          startDate: { lte: toDate(end) },
          OR: [{ endDate: null }, { endDate: { gte: toDate(start) } }],
        },
        orderBy: { startDate: 'desc' },
      });
      if (!contract) {
        skipped.push({ employeeName: name, reason: 'Aucun contrat sur ce mois' });
        continue;
      }

      const from = fromDate(employee.hireDate) > start ? fromDate(employee.hireDate) : start;
      const to = employee.terminationDate && fromDate(employee.terminationDate) < end ? fromDate(employee.terminationDate) : end;
      const monthDays = workDates(start, end).length;
      const employedDays = workDates(from, to).length;
      const proration = monthDays === 0 ? 0 : Math.min(1, employedDays / monthDays);

      const [unpaidDays, overtimeMinutes] = await this.attendanceFacts(ctx.companyId, employee.id, from, to);
      const prior = existing.get(employee.id);
      const advance = await this.advanceFor(ctx.companyId, employee.id, end);

      const additions = (prior?.additions ?? []) as unknown as PayItem[];
      const deductions = (prior?.deductions ?? []) as unknown as PayItem[];
      const result = computePayslip(rules, {
        baseSalary: contract.baseSalary.toFixed(),
        hourly: contract.salaryPeriod === 'HOURLY',
        weeklyHours: contract.weeklyHours.toFixed(),
        proration,
        unpaidDays: String(unpaidDays),
        overtimeMinutes,
        additions,
        deductions,
        advanceDeduction: advance.toFixed(2),
        dependents: employee.dependents,
      });

      const data = {
        employeeSnapshot: {
          fullName: name,
          employeeNumber: employee.employeeNumber,
          cin: employee.cin,
          cnssNumber: employee.cnssNumber,
          jobTitle: employee.jobTitle,
          departmentName: employee.department?.name ?? null,
          hireDate: fromDate(employee.hireDate),
          bankName: employee.bankName,
          rib: employee.rib,
          maritalStatus: employee.maritalStatus,
          dependents: employee.dependents,
        } as Prisma.InputJsonValue,
        rulesSnapshot: rules as unknown as Prisma.InputJsonValue,
        baseSalary: contract.baseSalary,
        weeklyHours: contract.weeklyHours,
        hourly: contract.salaryPeriod === 'HOURLY',
        dependents: employee.dependents,
        proration: toPrismaDecimal(proration.toFixed(4)),
        unpaidDays: toPrismaDecimal(unpaidDays),
        overtimeMinutes,
        additions: additions as unknown as Prisma.InputJsonValue,
        deductions: deductions as unknown as Prisma.InputJsonValue,
        ...resultColumns(result),
      };
      if (prior) await this.prisma.payslip.update({ where: { id: prior.id }, data });
      else await this.prisma.payslip.create({ data: { runId, employeeId: employee.id, ...data } });
    }

    await this.refreshTotals(runId);
    return skipped;
  }

  /** Unpaid working days (unpaid leave and unjustified absences, counted once) and overtime minutes. */
  private async attendanceFacts(
    companyId: string,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<[number, number]> {
    const [leave, records] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          companyId,
          employeeId,
          status: 'APPROVED',
          type: { isPaid: false },
          startDate: { lte: toDate(to) },
          endDate: { gte: toDate(from) },
        },
        select: { startDate: true, endDate: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { companyId, employeeId, date: { gte: toDate(from), lte: toDate(to) } },
        select: { date: true, status: true, overtimeMinutes: true },
      }),
    ]);
    const unpaid = new Set<string>();
    for (const request of leave) {
      const s = fromDate(request.startDate) > from ? fromDate(request.startDate) : from;
      const e = fromDate(request.endDate) < to ? fromDate(request.endDate) : to;
      for (const day of workDates(s, e)) unpaid.add(day);
    }
    let overtime = 0;
    for (const record of records) {
      overtime += record.overtimeMinutes;
      const day = fromDate(record.date);
      if (record.status === 'ABSENT' && toDate(day).getUTCDay() !== 0) unpaid.add(day);
    }
    return [unpaid.size, overtime];
  }

  /** What to take back this month across the employee's open advances. */
  private async advanceFor(companyId: string, employeeId: string, monthEnd: string): Promise<ReturnType<typeof dec>> {
    const advances = await this.prisma.salaryAdvance.findMany({
      where: { companyId, employeeId, date: { lte: toDate(monthEnd) } },
    });
    return advances.reduce((acc, a) => {
      const remaining = dec(a.amount.toFixed()).minus(dec(a.repaid.toFixed()));
      if (remaining.lte(0)) return acc;
      const monthly = dec(a.monthlyRepayment.toFixed());
      return acc.plus(monthly.lt(remaining) ? monthly : remaining);
    }, dec(0));
  }

  /** Share `amount` of repayment (or its reversal) across the employee's advances, oldest first. */
  private async applyAdvances(
    tx: Prisma.TransactionClient,
    companyId: string,
    employeeId: string,
    monthEnd: string,
    amount: ReturnType<typeof dec>,
    mode: 'repay' | 'reverse',
  ): Promise<void> {
    const advances = await tx.salaryAdvance.findMany({
      where: { companyId, employeeId, date: { lte: toDate(monthEnd) } },
      orderBy: { date: mode === 'repay' ? 'asc' : 'desc' },
    });
    let left = amount;
    for (const advance of advances) {
      if (left.lte(0)) break;
      const repaid = dec(advance.repaid.toFixed());
      const remaining = dec(advance.amount.toFixed()).minus(repaid);
      const room =
        mode === 'repay'
          ? remaining.lt(dec(advance.monthlyRepayment.toFixed())) ? remaining : dec(advance.monthlyRepayment.toFixed())
          : repaid;
      if (room.lte(0)) continue;
      const take = room.lt(left) ? room : left;
      await tx.salaryAdvance.update({
        where: { id: advance.id },
        data: { repaid: toPrismaDecimal(mode === 'repay' ? repaid.plus(take) : repaid.minus(take)) },
      });
      left = left.minus(take);
    }
    if (left.gt(0)) {
      throw AppError.unprocessable('ADVANCE_CHANGED', 'The advances changed since this run was computed; recompute it');
    }
  }

  private async refreshTotals(runId: string): Promise<void> {
    const sums = await this.prisma.payslip.aggregate({
      where: { runId },
      _sum: { grossSalary: true, netPay: true, employerCost: true },
    });
    await this.prisma.payrollRun.update({
      where: { id: runId },
      data: {
        totalGross: sums._sum.grossSalary ?? 0,
        totalNet: sums._sum.netPay ?? 0,
        totalEmployerCost: sums._sum.employerCost ?? 0,
      },
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private async rulesFor(companyId: string, date: string): Promise<PayrollRules> {
    const row = await this.latestRuleSet(companyId, date);
    return row ? row.rules : DEFAULT_PAYROLL_RULES;
  }

  private async latestRuleSet(companyId: string, date: string) {
    const row = await this.prisma.payrollRuleSet.findFirst({
      where: { companyId, effectiveFrom: { lte: toDate(date) } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) return null;
    return { effectiveFrom: row.effectiveFrom, rules: parseRules(row.rules) };
  }

  private async salaryCategory(tx: Prisma.TransactionClient, organizationId: string) {
    const existing = await tx.expenseCategory.findFirst({ where: { organizationId, kind: 'SALARY', isActive: true } });
    if (existing) return existing;
    return tx.expenseCategory.upsert({
      where: { organizationId_name: { organizationId, name: 'Salaires' } },
      create: { organizationId, name: 'Salaires', kind: 'SALARY' },
      update: { isActive: true, kind: 'SALARY' },
    });
  }

  private async detail(ctx: RequestContext, id: string, skipped: Skipped): Promise<RunDetail> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, companyId: ctx.companyId },
      include: {
        payslips: { include: payslipInclude, orderBy: { employee: { lastName: 'asc' } } },
      },
    });
    if (!run) throw AppError.notFound('Payroll run', id);
    return { ...mapRun(run, run.payslips.length), payslips: run.payslips.map(mapRow), skipped };
  }

  private async runOrThrow(ctx: RequestContext, id: string) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!run) throw AppError.notFound('Payroll run', id);
    return run;
  }

  private async payslipOrThrow(ctx: RequestContext, id: string) {
    const record = await this.prisma.payslip.findFirst({
      where: { id, run: { companyId: ctx.companyId } },
      include: { ...payslipInclude, run: { select: { year: true, month: true, status: true } } },
    });
    if (!record) throw AppError.notFound('Payslip', id);
    return record;
  }

  private mapPayslip(record: PayslipRecord & { run: { year: number; month: number; status: Payslip['status'] } }): Payslip {
    const snapshot = record.employeeSnapshot as Payslip['employee'];
    const additions = record.additions as unknown as PayItem[];
    const deductions = record.deductions as unknown as PayItem[];
    return {
      ...mapRow(record),
      runId: record.runId,
      year: record.run.year,
      month: record.run.month,
      status: record.run.status,
      employee: snapshot,
      weeklyHours: record.weeklyHours.toFixed(2),
      proration: record.proration.toFixed(4),
      additions,
      deductions,
      unpaidDeduction: moneyOut(record.unpaidDeduction),
      overtimePay: moneyOut(record.overtimePay),
      cnssBase: moneyOut(record.cnssBase),
      professionalExpenses: moneyOut(record.professionalExpenses),
      taxableNet: moneyOut(record.taxableNet),
      deductionsTotal: moneyOut(deductions.reduce((acc, d) => acc.plus(dec(d.amount)), dec(0))),
      cnssEmployer: moneyOut(record.cnssEmployer),
      familyAllowance: moneyOut(record.familyAllowance),
      trainingTax: moneyOut(record.trainingTax),
      amoEmployer: moneyOut(record.amoEmployer),
      otherEmployer: moneyOut(record.otherEmployer),
      employerContributions: moneyOut(record.employerContributions),
    };
  }

  private assertDraft(status: string): void {
    if (status !== 'DRAFT') {
      throw AppError.unprocessable('RUN_LOCKED', 'This run is validated; reopen it to make changes');
    }
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'create' | 'update' | 'delete'): void {
    if (!ctx.ability.can(action, 'Payroll')) {
      throw AppError.forbidden('Your role may not manage payroll');
    }
  }
}

/** A stored rule set is validated on the way out, so a hand-edited row cannot poison a payslip. */
function parseRules(raw: unknown): PayrollRules {
  const parsed = payrollSchemas.payrollRules.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PAYROLL_RULES;
}

function resultColumns(result: PayslipResult) {
  return {
    unpaidDeduction: toPrismaDecimal(result.unpaidDeduction),
    overtimePay: toPrismaDecimal(result.overtimePay),
    grossSalary: toPrismaDecimal(result.gross),
    cnssBase: toPrismaDecimal(result.cnssBase),
    cnssEmployee: toPrismaDecimal(result.cnssEmployee),
    amoEmployee: toPrismaDecimal(result.amoEmployee),
    professionalExpenses: toPrismaDecimal(result.professionalExpenses),
    taxableNet: toPrismaDecimal(result.taxableNet),
    incomeTax: toPrismaDecimal(result.incomeTax),
    advanceDeduction: toPrismaDecimal(result.advanceDeduction),
    netPay: toPrismaDecimal(result.netPay),
    cnssEmployer: toPrismaDecimal(result.cnssEmployer),
    familyAllowance: toPrismaDecimal(result.familyAllowance),
    trainingTax: toPrismaDecimal(result.trainingTax),
    amoEmployer: toPrismaDecimal(result.amoEmployer),
    otherEmployer: toPrismaDecimal(result.otherEmployer),
    employerContributions: toPrismaDecimal(result.employerContributions),
    employerCost: toPrismaDecimal(result.employerCost),
  };
}

function mapRun(run: Prisma.PayrollRunGetPayload<object>, count: number): RunSummary {
  return {
    id: run.id,
    year: run.year,
    month: run.month,
    status: run.status,
    payslipCount: count,
    totalGross: moneyOut(run.totalGross),
    totalNet: moneyOut(run.totalNet),
    totalEmployerCost: moneyOut(run.totalEmployerCost),
    paidAt: run.paidAt ? fromDate(run.paidAt) : null,
    expenseId: run.expenseId,
    validatedAt: run.validatedAt?.toISOString() ?? null,
  };
}

function mapRow(record: PayslipRecord): PayslipRow {
  const additions = record.additions as unknown as PayItem[];
  const additionsTotal = additions.reduce((acc, item) => acc.plus(dec(item.amount)), dec(0));
  const base = dec(record.grossSalary.toFixed())
    .minus(dec(record.overtimePay.toFixed()))
    .minus(additionsTotal)
    .plus(dec(record.unpaidDeduction.toFixed()));
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: `${record.employee.firstName} ${record.employee.lastName}`,
    employeeNumber: record.employee.employeeNumber,
    baseSalary: moneyOut(base),
    unpaidDays: record.unpaidDays.toFixed(1),
    overtimeMinutes: record.overtimeMinutes,
    grossSalary: moneyOut(record.grossSalary),
    cnssEmployee: moneyOut(record.cnssEmployee),
    amoEmployee: moneyOut(record.amoEmployee),
    incomeTax: moneyOut(record.incomeTax),
    advanceDeduction: moneyOut(record.advanceDeduction),
    netPay: moneyOut(record.netPay),
    employerCost: moneyOut(record.employerCost),
  };
}

function mapAdvance(
  row: Prisma.SalaryAdvanceGetPayload<{ include: { employee: { select: { firstName: true; lastName: true } } } }>,
): Advance {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
    amount: moneyOut(row.amount),
    date: fromDate(row.date),
    monthlyRepayment: moneyOut(row.monthlyRepayment),
    repaid: moneyOut(row.repaid),
    remaining: moneyOut(dec(row.amount.toFixed()).minus(dec(row.repaid.toFixed()))),
    note: row.note,
  };
}
