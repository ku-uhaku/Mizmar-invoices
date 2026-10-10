import { Injectable } from '@nestjs/common';
import type { hrSchemas } from '@mizmar/contracts';
import type { z } from 'zod';
import { AppError } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestContext } from '../tenancy/request-context';
import { toDate } from './hr.service';

type Row = z.infer<typeof hrSchemas.attendanceRow>;
type Save = z.infer<typeof hrSchemas.attendanceSave>;

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everyone employed on `date`, with what has been recorded for them (if anything). */
  async day(ctx: RequestContext, date: string): Promise<Row[]> {
    this.assertCan(ctx, 'read');
    const day = toDate(date);
    const [employees, records, leave] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          companyId: ctx.companyId,
          hireDate: { lte: day },
          OR: [{ terminationDate: null }, { terminationDate: { gte: day } }],
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, employeeNumber: true },
      }),
      this.prisma.attendanceRecord.findMany({ where: { companyId: ctx.companyId, date: day } }),
      this.prisma.leaveRequest.findMany({
        where: { companyId: ctx.companyId, status: 'APPROVED', startDate: { lte: day }, endDate: { gte: day } },
        select: { employeeId: true },
      }),
    ]);
    const byEmployee = new Map(records.map((record) => [record.employeeId, record]));
    const onLeave = new Set(leave.map((row) => row.employeeId));

    return employees.map((employee) => {
      const record = byEmployee.get(employee.id);
      return {
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeNumber: employee.employeeNumber,
        status: record?.status ?? null,
        checkIn: record?.checkIn ?? null,
        checkOut: record?.checkOut ?? null,
        overtimeMinutes: record?.overtimeMinutes ?? 0,
        note: record?.note ?? null,
        onLeave: onLeave.has(employee.id),
      };
    });
  }

  async save(ctx: RequestContext, body: Save): Promise<Row[]> {
    this.assertCan(ctx, 'update');
    const ids = [...new Set(body.entries.map((entry) => entry.employeeId))];
    const valid = await this.prisma.employee.count({ where: { id: { in: ids }, companyId: ctx.companyId } });
    if (valid !== ids.length) throw AppError.notFound('One or more employees');

    const date = toDate(body.date);
    await this.prisma.$transaction(
      body.entries.map((entry) => {
        const data = {
          status: entry.status,
          checkIn: entry.checkIn ?? null,
          checkOut: entry.checkOut ?? null,
          overtimeMinutes: entry.overtimeMinutes,
          note: entry.note ?? null,
        };
        return this.prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: entry.employeeId, date } },
          create: { companyId: ctx.companyId, employeeId: entry.employeeId, date, ...data },
          update: data,
        });
      }),
    );
    return this.day(ctx, body.date);
  }

  private assertCan(ctx: RequestContext, action: 'read' | 'update'): void {
    if (!ctx.ability.can(action, 'Attendance')) {
      throw AppError.forbidden('Your role may not manage attendance');
    }
  }
}
