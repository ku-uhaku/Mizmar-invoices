import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { localDate } from '@mizmar/core';
import type { hrSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { moneyOut, qtyOut, toPrismaDecimal } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';

type Employee = z.infer<typeof hrSchemas.employee>;
type EmployeeCreate = z.infer<typeof hrSchemas.employeeCreate>;
type EmployeeUpdate = z.infer<typeof hrSchemas.employeeUpdate>;
type EmployeeListQuery = z.infer<typeof hrSchemas.employeeListQuery>;
type ContractBody = z.infer<typeof hrSchemas.contractBody>;
type Contract = z.infer<typeof hrSchemas.contract>;
type Department = z.infer<typeof hrSchemas.department>;
type Overview = z.infer<typeof hrSchemas.hrOverview>;

export const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
export const fromDate = (value: Date) => value.toISOString().slice(0, 10);
const dayBefore = (value: string) => {
  const d = toDate(value);
  d.setUTCDate(d.getUTCDate() - 1);
  return fromDate(d);
};

const employeeInclude = {
  department: { select: { name: true } },
  contracts: { where: { isCurrent: true }, orderBy: { startDate: 'desc' }, take: 1 },
} satisfies Prisma.EmployeeInclude;

/** Employees, departments and contracts. */
@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

  // -- Departments ------------------------------------------------------------

  async listDepartments(ctx: RequestContext): Promise<Department[]> {
    this.assertCan(ctx, 'read', 'Employee');
    const rows = await this.prisma.department.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: { where: { status: 'ACTIVE' } } } } },
    });
    return rows.map((row) => ({ id: row.id, name: row.name, employeeCount: row._count.employees }));
  }

  async createDepartment(ctx: RequestContext, body: { name: string }): Promise<Department> {
    this.assertCan(ctx, 'create', 'Employee');
    try {
      const row = await this.prisma.department.create({
        data: { companyId: ctx.companyId, name: body.name.trim() },
      });
      return { id: row.id, name: row.name, employeeCount: 0 };
    } catch (error) {
      throw this.duplicate(error, 'DEPARTMENT_EXISTS', 'This department already exists');
    }
  }

  async updateDepartment(ctx: RequestContext, id: string, body: { name: string }): Promise<Department> {
    this.assertCan(ctx, 'update', 'Employee');
    await this.departmentOrThrow(ctx, id);
    try {
      const row = await this.prisma.department.update({ where: { id }, data: { name: body.name.trim() } });
      const count = await this.prisma.employee.count({ where: { departmentId: id, status: 'ACTIVE' } });
      return { id: row.id, name: row.name, employeeCount: count };
    } catch (error) {
      throw this.duplicate(error, 'DEPARTMENT_EXISTS', 'This department already exists');
    }
  }

  async removeDepartment(ctx: RequestContext, id: string): Promise<void> {
    this.assertCan(ctx, 'delete', 'Employee');
    await this.departmentOrThrow(ctx, id);
    // Employees keep their record; the schema clears their department.
    await this.prisma.department.delete({ where: { id } });
  }

  // -- Employees --------------------------------------------------------------

  async listEmployees(ctx: RequestContext, query: EmployeeListQuery): Promise<Employee[]> {
    this.assertCan(ctx, 'read', 'Employee');
    const search = query.search?.trim();
    const rows = await this.prisma.employee.findMany({
      where: {
        companyId: ctx.companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { employeeNumber: { contains: search, mode: 'insensitive' } },
                { jobTitle: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
      include: employeeInclude,
    });
    const showPay = this.canSeePay(ctx);
    return rows.map((row) => mapEmployee(row, showPay));
  }

  async getEmployee(ctx: RequestContext, id: string): Promise<Employee> {
    this.assertCan(ctx, 'read', 'Employee');
    return mapEmployee(await this.employeeOrThrow(ctx, id), this.canSeePay(ctx));
  }

  async createEmployee(ctx: RequestContext, body: EmployeeCreate): Promise<Employee> {
    this.assertCan(ctx, 'create', 'Employee');
    if (body.departmentId) await this.departmentOrThrow(ctx, body.departmentId);
    if (body.contract && !this.canSeePay(ctx)) {
      throw AppError.forbidden('Your role may not set salaries');
    }
    const employeeNumber = body.employeeNumber?.trim() || (await this.nextNumber(ctx));

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const created = await tx.employee.create({
          data: {
            companyId: ctx.companyId,
            employeeNumber,
            firstName: body.firstName.trim(),
            lastName: body.lastName.trim(),
            cin: body.cin || null,
            cnssNumber: body.cnssNumber || null,
            birthDate: body.birthDate ? toDate(body.birthDate) : null,
            hireDate: toDate(body.hireDate),
            jobTitle: body.jobTitle || null,
            departmentId: body.departmentId || null,
            phone: body.phone || null,
            email: body.email || null,
            address: body.address || null,
            bankName: body.bankName || null,
            rib: body.rib || null,
            maritalStatus: body.maritalStatus,
            dependents: body.dependents,
          },
        });
        if (body.contract) await this.insertContract(tx, created.id, body.contract);
        return created.id;
      });
      return mapEmployee(await this.employeeOrThrow(ctx, id), this.canSeePay(ctx));
    } catch (error) {
      throw this.duplicate(error, 'EMPLOYEE_NUMBER_EXISTS', 'This employee number is already used');
    }
  }

  async updateEmployee(ctx: RequestContext, id: string, body: EmployeeUpdate): Promise<Employee> {
    this.assertCan(ctx, 'update', 'Employee');
    const existing = await this.employeeOrThrow(ctx, id);
    if (body.departmentId) await this.departmentOrThrow(ctx, body.departmentId);

    const data: Prisma.EmployeeUncheckedUpdateInput = {};
    const text = <K extends keyof EmployeeUpdate>(key: K) => {
      if (body[key] !== undefined) (data as Record<string, unknown>)[key] = (body[key] as string | null) || null;
    };
    if (body.employeeNumber) data.employeeNumber = body.employeeNumber.trim();
    if (body.firstName) data.firstName = body.firstName.trim();
    if (body.lastName) data.lastName = body.lastName.trim();
    for (const key of ['cin', 'cnssNumber', 'jobTitle', 'phone', 'email', 'address', 'bankName', 'rib', 'departmentId'] as const) {
      text(key);
    }
    if (body.birthDate !== undefined) data.birthDate = body.birthDate ? toDate(body.birthDate) : null;
    if (body.hireDate) data.hireDate = toDate(body.hireDate);
    if (body.maritalStatus) data.maritalStatus = body.maritalStatus;
    if (body.dependents !== undefined) data.dependents = body.dependents;
    if (body.terminationDate !== undefined) data.terminationDate = body.terminationDate ? toDate(body.terminationDate) : null;

    const terminating = body.status === 'TERMINATED' && existing.status !== 'TERMINATED';
    if (body.status) data.status = body.status;
    if (terminating && !body.terminationDate) data.terminationDate = toDate(localDate(new Date()));
    if (body.status === 'ACTIVE') data.terminationDate = null;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.employee.update({ where: { id }, data });
        if (terminating) {
          // The contract ends with the employment.
          const end = body.terminationDate ?? localDate(new Date());
          await tx.employmentContract.updateMany({
            where: { employeeId: id, isCurrent: true, endDate: null },
            data: { endDate: toDate(end) },
          });
          await tx.employmentContract.updateMany({
            where: { employeeId: id, isCurrent: true },
            data: { isCurrent: false },
          });
        }
      });
    } catch (error) {
      throw this.duplicate(error, 'EMPLOYEE_NUMBER_EXISTS', 'This employee number is already used');
    }
    return mapEmployee(await this.employeeOrThrow(ctx, id), this.canSeePay(ctx));
  }

  // -- Contracts --------------------------------------------------------------

  async listContracts(ctx: RequestContext, employeeId: string): Promise<Contract[]> {
    this.assertCan(ctx, 'read', 'Employee');
    await this.employeeOrThrow(ctx, employeeId);
    const rows = await this.prisma.employmentContract.findMany({
      where: { employeeId },
      orderBy: { startDate: 'desc' },
    });
    const showPay = this.canSeePay(ctx);
    return rows.map((row) => mapContract(row, showPay));
  }

  async createContract(ctx: RequestContext, employeeId: string, body: ContractBody): Promise<Contract> {
    this.assertCan(ctx, 'update', 'Employee');
    if (!this.canSeePay(ctx)) throw AppError.forbidden('Your role may not set salaries');
    const employee = await this.employeeOrThrow(ctx, employeeId);
    if (employee.status === 'TERMINATED') {
      throw AppError.unprocessable('EMPLOYEE_TERMINATED', 'This employee has left the company');
    }
    const row = await this.prisma.$transaction((tx) => this.insertContract(tx, employeeId, body));
    return mapContract(row, true);
  }

  // -- Overview ---------------------------------------------------------------

  async overview(ctx: RequestContext): Promise<Overview> {
    this.assertCan(ctx, 'read', 'Employee');
    const today = localDate(new Date());
    const soon = new Date(toDate(today).getTime() + 30 * 86_400_000);

    const [headcount, onLeave, pending, absent, ending] = await Promise.all([
      this.prisma.employee.count({ where: { companyId: ctx.companyId, status: 'ACTIVE' } }),
      this.prisma.leaveRequest.findMany({
        where: {
          companyId: ctx.companyId,
          status: 'APPROVED',
          startDate: { lte: toDate(today) },
          endDate: { gte: toDate(today) },
        },
        select: { employeeId: true },
        distinct: ['employeeId'],
      }),
      this.prisma.leaveRequest.count({ where: { companyId: ctx.companyId, status: 'PENDING' } }),
      this.prisma.attendanceRecord.count({
        where: { companyId: ctx.companyId, date: toDate(today), status: 'ABSENT' },
      }),
      this.prisma.employmentContract.findMany({
        where: {
          isCurrent: true,
          endDate: { gte: toDate(today), lte: soon },
          employee: { companyId: ctx.companyId, status: 'ACTIVE' },
        },
        orderBy: { endDate: 'asc' },
        select: { endDate: true, employee: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);

    return {
      headcount,
      onLeaveToday: onLeave.length,
      pendingLeave: pending,
      absentToday: absent,
      contractsEndingSoon: ending.map((row) => ({
        employeeId: row.employee.id,
        employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
        endDate: fromDate(row.endDate!),
      })),
    };
  }

  // -- Internals --------------------------------------------------------------

  /** The new contract becomes the current one; the previous one is closed the day before. */
  private async insertContract(tx: Prisma.TransactionClient, employeeId: string, body: ContractBody) {
    const previous = await tx.employmentContract.findMany({ where: { employeeId, isCurrent: true } });
    for (const old of previous) {
      await tx.employmentContract.update({
        where: { id: old.id },
        data: { isCurrent: false, ...(old.endDate ? {} : { endDate: toDate(dayBefore(body.startDate)) }) },
      });
    }
    return tx.employmentContract.create({
      data: {
        employeeId,
        type: body.type,
        startDate: toDate(body.startDate),
        endDate: body.endDate ? toDate(body.endDate) : null,
        baseSalary: toPrismaDecimal(body.baseSalary),
        salaryPeriod: body.salaryPeriod,
        weeklyHours: toPrismaDecimal(body.weeklyHours),
        isCurrent: true,
      },
    });
  }

  private async nextNumber(ctx: RequestContext): Promise<string> {
    let n = (await this.prisma.employee.count({ where: { companyId: ctx.companyId } })) + 1;
    for (;;) {
      const candidate = `EMP-${String(n).padStart(3, '0')}`;
      const taken = await this.prisma.employee.count({
        where: { companyId: ctx.companyId, employeeNumber: candidate },
      });
      if (!taken) return candidate;
      n++;
    }
  }

  private async employeeOrThrow(ctx: RequestContext, id: string) {
    const row = await this.prisma.employee.findFirst({
      where: { id, companyId: ctx.companyId },
      include: employeeInclude,
    });
    if (!row) throw AppError.notFound('Employee', id);
    return row;
  }

  private async departmentOrThrow(ctx: RequestContext, id: string) {
    const row = await this.prisma.department.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!row) throw AppError.notFound('Department', id);
    return row;
  }

  /** Salaries and bank details belong to people who may read payroll. */
  private canSeePay(ctx: RequestContext): boolean {
    return ctx.ability.can('read', 'Payroll');
  }

  private assertCan(
    ctx: RequestContext,
    action: 'read' | 'create' | 'update' | 'delete',
    subject: 'Employee',
  ): void {
    if (!ctx.ability.can(action, subject)) {
      throw AppError.forbidden('Your role may not manage employees');
    }
  }

  private duplicate(error: unknown, code: string, message: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return AppError.conflict(code, message);
    }
    return error;
  }
}

function mapContract(
  row: Prisma.EmploymentContractGetPayload<object>,
  showPay: boolean,
): Contract {
  return {
    id: row.id,
    employeeId: row.employeeId,
    type: row.type,
    startDate: fromDate(row.startDate),
    endDate: row.endDate ? fromDate(row.endDate) : null,
    baseSalary: showPay ? moneyOut(row.baseSalary) : null,
    salaryPeriod: row.salaryPeriod,
    weeklyHours: qtyOut(row.weeklyHours).replace(/0+$/, '').replace(/\.$/, ''),
    isCurrent: row.isCurrent,
  };
}

export function mapEmployee(
  row: Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>,
  showPay: boolean,
): Employee {
  const current = row.contracts[0];
  return {
    id: row.id,
    employeeNumber: row.employeeNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`,
    cin: row.cin,
    cnssNumber: row.cnssNumber,
    birthDate: row.birthDate ? fromDate(row.birthDate) : null,
    hireDate: fromDate(row.hireDate),
    terminationDate: row.terminationDate ? fromDate(row.terminationDate) : null,
    jobTitle: row.jobTitle,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    phone: row.phone,
    email: row.email,
    address: row.address,
    bankName: row.bankName,
    rib: showPay ? row.rib : null,
    status: row.status,
    maritalStatus: row.maritalStatus,
    dependents: row.dependents,
    currentContract: current ? mapContract(current, showPay) : null,
  };
}
