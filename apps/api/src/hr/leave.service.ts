import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, leaveEntitlement, localDate, workingDays } from '@mizmar/core';
import type { hrSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { qtyOut, toPrismaDecimal } from '../common/util/decimal';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { fromDate, toDate } from './hr.service';

type LeaveType = z.infer<typeof hrSchemas.leaveType>;
type LeaveTypeBody = z.infer<typeof hrSchemas.leaveTypeBody>;
type LeaveCreate = z.infer<typeof hrSchemas.leaveCreate>;
type LeaveRequest = z.infer<typeof hrSchemas.leaveRequest>;
type LeaveListQuery = z.infer<typeof hrSchemas.leaveListQuery>;
type BalanceRow = z.infer<typeof hrSchemas.leaveBalanceRow>;

/** Editable starting point; the entitlements follow the Moroccan labour code (1.5 days a month). */
const DEFAULT_TYPES: Array<[string, boolean, string]> = [
  ['Congé annuel', true, '18'],
  ['Congé maladie', false, '0'],
  ['Congé sans solde', false, '0'],
  ['Congé de maternité', true, '98'],
  ['Congé de naissance', true, '3'],
  ['Congé de mariage', true, '4'],
];

const requestInclude = {
  employee: { select: { firstName: true, lastName: true } },
  type: { select: { name: true, isPaid: true } },
} satisfies Prisma.LeaveRequestInclude;

@Injectable()
export class LeaveService {
  constructor(private readonly prisma: PrismaService) {}

  // -- Types ------------------------------------------------------------------

  async listTypes(ctx: RequestContext): Promise<LeaveType[]> {
    this.assertCan(ctx, 'read');
    if ((await this.prisma.leaveType.count({ where: { companyId: ctx.companyId } })) === 0) {
      await this.prisma.leaveType.createMany({
        data: DEFAULT_TYPES.map(([name, isPaid, daysPerYear]) => ({
          companyId: ctx.companyId,
          name,
          isPaid,
          daysPerYear,
        })),
        skipDuplicates: true,
      });
    }
    const rows = await this.prisma.leaveType.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { name: 'asc' },
    });
    return rows.map(mapType);
  }

  async createType(ctx: RequestContext, body: LeaveTypeBody): Promise<LeaveType> {
    this.assertCan(ctx, 'create');
    try {
      const row = await this.prisma.leaveType.create({
        data: {
          companyId: ctx.companyId,
          name: body.name.trim(),
          isPaid: body.isPaid,
          daysPerYear: toPrismaDecimal(body.daysPerYear),
          isActive: body.isActive,
        },
      });
      return mapType(row);
    } catch (error) {
      throw this.duplicate(error);
    }
  }

  async updateType(ctx: RequestContext, id: string, body: Partial<LeaveTypeBody>): Promise<LeaveType> {
    this.assertCan(ctx, 'update');
    const existing = await this.prisma.leaveType.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!existing) throw AppError.notFound('Leave type', id);
    try {
      const row = await this.prisma.leaveType.update({
        where: { id },
        data: {
          ...(body.name ? { name: body.name.trim() } : {}),
          ...(body.isPaid !== undefined ? { isPaid: body.isPaid } : {}),
          ...(body.daysPerYear !== undefined ? { daysPerYear: toPrismaDecimal(body.daysPerYear) } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
      return mapType(row);
    } catch (error) {
      throw this.duplicate(error);
    }
  }

  // -- Requests ---------------------------------------------------------------

  async list(ctx: RequestContext, query: LeaveListQuery): Promise<LeaveRequest[]> {
    this.assertCan(ctx, 'read');
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        companyId: ctx.companyId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.year
          ? { startDate: { gte: toDate(`${query.year}-01-01`), lte: toDate(`${query.year}-12-31`) } }
          : {}),
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      include: requestInclude,
    });
    return rows.map(mapRequest);
  }

  async create(ctx: RequestContext, body: LeaveCreate): Promise<LeaveRequest> {
    this.assertCan(ctx, 'create');
    if (body.endDate < body.startDate) {
      throw AppError.badRequest('INVALID_DATES', 'The end date is before the start date');
    }
    const [employee, type] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: body.employeeId, companyId: ctx.companyId } }),
      this.prisma.leaveType.findFirst({ where: { id: body.typeId, companyId: ctx.companyId, isActive: true } }),
    ]);
    if (!employee) throw AppError.notFound('Employee', body.employeeId);
    if (!type) throw AppError.notFound('Leave type', body.typeId);
    if (employee.status !== 'ACTIVE') {
      throw AppError.unprocessable('EMPLOYEE_TERMINATED', 'This employee has left the company');
    }

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: toDate(body.endDate) },
        endDate: { gte: toDate(body.startDate) },
      },
      select: { id: true },
    });
    if (overlap) {
      throw AppError.unprocessable('LEAVE_OVERLAP', 'This employee already has leave on some of these dates');
    }

    const days = body.days ?? String(workingDays(body.startDate, body.endDate));
    if (dec(days).lte(0)) {
      throw AppError.badRequest('INVALID_DAYS', 'The leave covers no working day');
    }
    const row = await this.prisma.leaveRequest.create({
      data: {
        companyId: ctx.companyId,
        employeeId: employee.id,
        typeId: type.id,
        startDate: toDate(body.startDate),
        endDate: toDate(body.endDate),
        days: toPrismaDecimal(days),
        reason: body.reason ?? null,
        createdById: ctx.userId,
      },
      include: requestInclude,
    });
    return mapRequest(row);
  }

  /** Approval is a management decision, so it needs the right to update leave. */
  async decide(ctx: RequestContext, id: string, approve: boolean): Promise<LeaveRequest> {
    this.assertCan(ctx, 'update');
    const request = await this.findOrThrow(ctx, id);
    if (request.status !== 'PENDING') {
      throw AppError.unprocessable('LEAVE_NOT_PENDING', 'This request has already been decided');
    }
    const row = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedById: ctx.userId,
        decidedAt: new Date(),
      },
      include: requestInclude,
    });
    return mapRequest(row);
  }

  async cancel(ctx: RequestContext, id: string): Promise<LeaveRequest> {
    this.assertCan(ctx, 'update');
    const request = await this.findOrThrow(ctx, id);
    if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
      throw AppError.unprocessable('LEAVE_NOT_CANCELLABLE', 'This request can no longer be cancelled');
    }
    const row = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'CANCELLED', decidedById: ctx.userId, decidedAt: new Date() },
      include: requestInclude,
    });
    return mapRequest(row);
  }

  // -- Balances ---------------------------------------------------------------

  async balances(ctx: RequestContext, year?: number): Promise<BalanceRow[]> {
    this.assertCan(ctx, 'read');
    const y = year ?? Number(localDate(new Date()).slice(0, 4));
    const [employees, types, requests] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId: ctx.companyId, status: 'ACTIVE' },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, hireDate: true },
      }),
      this.listTypes(ctx),
      this.prisma.leaveRequest.findMany({
        where: {
          companyId: ctx.companyId,
          status: { in: ['PENDING', 'APPROVED'] },
          startDate: { gte: toDate(`${y}-01-01`), lte: toDate(`${y}-12-31`) },
        },
        select: { employeeId: true, typeId: true, status: true, days: true },
      }),
    ]);

    const rows: BalanceRow[] = [];
    for (const employee of employees) {
      for (const type of types.filter((t) => t.isActive && dec(t.daysPerYear).gt(0))) {
        const mine = requests.filter((r) => r.employeeId === employee.id && r.typeId === type.id);
        const sum = (status: string) =>
          mine.filter((r) => r.status === status).reduce((acc, r) => acc.plus(dec(r.days.toFixed())), dec(0));
        const entitlement = leaveEntitlement(Number(type.daysPerYear), fromDate(employee.hireDate), y);
        const taken = sum('APPROVED');
        rows.push({
          employeeId: employee.id,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          typeId: type.id,
          typeName: type.name,
          entitlement: qtyOut(entitlement).replace(/0+$/, '').replace(/\.$/, ''),
          taken: qtyOut(taken).replace(/0+$/, '').replace(/\.$/, '') || '0',
          pending: qtyOut(sum('PENDING')).replace(/0+$/, '').replace(/\.$/, '') || '0',
          remaining: qtyOut(dec(entitlement).minus(taken)).replace(/0+$/, '').replace(/\.$/, '') || '0',
        });
      }
    }
    return rows;
  }

  // -- Internals --------------------------------------------------------------

  private async findOrThrow(ctx: RequestContext, id: string) {
    const row = await this.prisma.leaveRequest.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!row) throw AppError.notFound('Leave request', id);
    return row;
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'create' | 'update'): void {
    if (!ctx.ability.can(action, 'Leave')) {
      throw AppError.forbidden('Your role may not manage leave');
    }
  }

  private duplicate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return AppError.conflict('LEAVE_TYPE_EXISTS', 'A leave type with this name already exists');
    }
    return error;
  }
}

function mapType(row: Prisma.LeaveTypeGetPayload<object>): LeaveType {
  return {
    id: row.id,
    name: row.name,
    isPaid: row.isPaid,
    daysPerYear: qtyOut(row.daysPerYear).replace(/0+$/, '').replace(/\.$/, '') || '0',
    isActive: row.isActive,
  };
}

function mapRequest(row: Prisma.LeaveRequestGetPayload<{ include: typeof requestInclude }>): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
    typeId: row.typeId,
    typeName: row.type.name,
    isPaid: row.type.isPaid,
    startDate: fromDate(row.startDate),
    endDate: fromDate(row.endDate),
    days: qtyOut(row.days).replace(/0+$/, '').replace(/\.$/, '') || '0',
    reason: row.reason,
    status: row.status,
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}
